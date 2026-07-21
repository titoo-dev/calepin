// Logique de la TUI (voir docs/adr/0004) : tout ce qui n'est pas du rendu vit
// ici, testable via `node --test` sans TTY ni build TypeScript. src-ui/ importe
// ce module et ne fait que du rendu (ink/@clack/prompts).
//
// ponytail: quelques fonctions (scanSecrets, recordTopic) dupliquent une
// logique déjà présente dans calepin.mjs (SECRET_PATTERNS, cmdRecord). Le
// cadre (ADR 0004) interdit de toucher calepin.mjs au-delà du routage vers la
// TUI — extraire ces bouts dans lib/ casserait cette règle. Duplication petite
// et stable, upgrade path si un jour calepin.mjs est réécrit : partager un
// seul module.

import * as store from './store.mjs';
import { parseTopic } from './format.mjs';
import { clientRequest } from './serve.mjs';
import { runQuery } from './query.mjs';
import { getEmbedder, embedTopics } from './embed.mjs';
import { dream } from './dream.mjs';
import { loadHits, removeHit } from './hits.mjs';

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Même liste que SECRET_PATTERNS dans calepin.mjs (voir ponytail en tête de fichier).
const SECRET_PATTERNS = [
  { name: 'clé AWS (AKIA...)', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'clé API OpenAI-like (sk-...)', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'token GitHub (ghp_...)', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'clé privée PEM', re: /-----BEGIN .* PRIVATE KEY/ },
  { name: 'jeton Bearer', re: /Bearer [A-Za-z0-9._-]{20,}/ },
  { name: 'mot de passe en clair', re: /password\s*[:=]\s*\S+/i },
];

/** Nom du premier motif de secret détecté dans `text`, ou null. */
export function scanSecrets(text) {
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** [{space, path, obj, raw}] pour tous les sujets des espaces actifs (ou un seul via spaceLabel). */
export function loadTopics(cwd, spaceLabel = null) {
  let spaces = store.activeSpaces(cwd);
  if (spaceLabel) spaces = spaces.filter((s) => s.label === spaceLabel);
  const topics = [];
  for (const sp of spaces) {
    for (const entry of store.listTopics(sp)) {
      const raw = store.readTopic(sp, entry.path);
      if (raw == null) continue;
      topics.push({ space: entry.space, path: entry.path, obj: parseTopic(raw), raw });
    }
  }
  return topics;
}

/**
 * groupByNamespace(topics) -> [{namespace, items}] trié alpha (namespace puis path).
 * namespace = premier segment du chemin ("categorie/slug" -> "categorie").
 */
export function groupByNamespace(topics) {
  const groups = new Map();
  for (const t of topics) {
    const ns = t.path.includes('/') ? t.path.slice(0, t.path.indexOf('/')) : t.path;
    if (!groups.has(ns)) groups.set(ns, []);
    groups.get(ns).push(t);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, items]) => ({
      namespace,
      items: [...items].sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

/** Filtre topics par sous-chaîne sur chemin/titre/keywords, insensible casse+accents. Vide -> tout. */
export function filterTopics(topics, query) {
  const q = norm(query ?? '').trim();
  if (!q) return topics;
  return topics.filter((t) => {
    const hay = [t.path, t.obj?.title ?? '', ...(t.obj?.keywords ?? [])].join(' ');
    return norm(hay).includes(q);
  });
}

function typedElementCount(obj) {
  return (
    (obj.decisions?.length ?? 0) +
    (obj.reasons?.length ?? 0) +
    (obj.facts?.length ?? 0) +
    (obj.rules?.length ?? 0) +
    (obj.files?.length ?? 0)
  );
}

/**
 * mergePlan(a, b) -> { keep, drop } : propose de garder le sujet le plus
 * riche (le plus d'éléments typés cal-*), à confirmer par l'utilisateur.
 * a, b: {space, path, obj}. Égalité -> a gagne.
 */
export function mergePlan(a, b) {
  return typedElementCount(b.obj) > typedElementCount(a.obj) ? { keep: b, drop: a } : { keep: a, drop: b };
}

export const DREAM_MODES = ['merge', 'link', 'prune', 'synthesize'];

/** Action déclenchée par [a]ppliquer selon le mode dream courant (voir PRD F4). Jette si mode inconnu. */
export function dreamApplyKind(mode) {
  if (!DREAM_MODES.includes(mode)) throw new Error(`dreamApplyKind: mode inconnu "${mode}"`);
  return mode;
}

/** "space/categorie/slug" -> {space, path} (split sur le 1er "/" : les labels d'espace n'en contiennent pas). */
export function splitTopicKey(key) {
  const idx = key.indexOf('/');
  return { space: key.slice(0, idx), path: key.slice(idx + 1) };
}

function findSpaceByLabel(cwd, label) {
  return store.activeSpaces(cwd).find((s) => s.label === label) ?? null;
}

/** Sujet complet {space, path, obj, raw} pour une clé "space/path", ou null si absent. */
export function readTopicByKey(cwd, key) {
  const { space: spaceLabel, path: topicPath } = splitTopicKey(key);
  const space = findSpaceByLabel(cwd, spaceLabel);
  if (!space) return null;
  const raw = store.readTopic(space, topicPath);
  if (raw == null) return null;
  return { space: spaceLabel, path: topicPath, obj: parseTopic(raw), raw };
}

/** query hybride (daemon si vivant, sinon in-process) — même contrat que `calepin query`. */
export async function queryMemory({ cwd, question, limit = 5, space = null, noEmbed = false }) {
  if (noEmbed) process.env.CALEPIN_NO_EMBED = '1';
  const served = await clientRequest({ op: 'query', cwd, question, limit, space, noEmbed });
  if (served && !served.error) return { ...served, served: true };
  const out = await runQuery({ cwd, question, limit, space, noEmbed });
  return { ...out, served: false };
}

/** dream — même contrat que `calepin dream` (analyse seule, ne modifie rien). */
export async function runDreamAnalysis({ cwd, mode, minScore, limit = 10, space = null, noEmbed = false }) {
  if (noEmbed) process.env.CALEPIN_NO_EMBED = '1';
  const topics = loadTopics(cwd, space);
  let topicVectors = null;
  const embedder = await getEmbedder();
  if (embedder) {
    try {
      topicVectors = await embedTopics(topics, embedder);
    } catch {
      // fallback jaccard silencieux — même contrat que cmdDream (cosinus indisponible n'est jamais bloquant)
    }
  }
  return dream(topics, { mode, minScore, limit, topicVectors, hits: loadHits() });
}

/** merge appliqué : supprime le sujet `dropKey` ("space/path"). -> true si supprimé. */
export function applyMerge(cwd, dropKey) {
  const { space: spaceLabel, path: topicPath } = splitTopicKey(dropKey);
  const space = findSpaceByLabel(cwd, spaceLabel);
  if (!space) throw new Error(`applyMerge: espace "${spaceLabel}" introuvable`);
  const removed = store.removeTopic(space, topicPath);
  if (removed) removeHit(dropKey);
  return removed;
}

/** link appliqué : ajoute un cal-link réciproque entre les 2 sujets de paths=[a,b]. */
export function applyLink(cwd, paths) {
  const [keyA, keyB] = paths;
  for (const [selfKey, otherKey] of [
    [keyA, keyB],
    [keyB, keyA],
  ]) {
    const { space: spaceLabel, path: topicPath } = splitTopicKey(selfKey);
    const { path: otherPath } = splitTopicKey(otherKey);
    const space = findSpaceByLabel(cwd, spaceLabel);
    if (!space) throw new Error(`applyLink: espace "${spaceLabel}" introuvable`);
    const raw = store.readTopic(space, topicPath);
    if (raw == null) throw new Error(`applyLink: sujet "${selfKey}" introuvable`);
    const obj = parseTopic(raw);
    if (!obj.links.includes(otherPath)) {
      obj.links = [...obj.links, otherPath];
      obj.updated = todayISO();
      store.writeTopic(space, topicPath, obj);
    }
  }
}

/** prune appliqué : supprime le sujet candidat `key` ("space/path"). -> true si supprimé. */
export function applyPrune(cwd, key) {
  const { space: spaceLabel, path: topicPath } = splitTopicKey(key);
  const space = findSpaceByLabel(cwd, spaceLabel);
  if (!space) throw new Error(`applyPrune: espace "${spaceLabel}" introuvable`);
  const removed = store.removeTopic(space, topicPath);
  if (removed) removeHit(key);
  return removed;
}

/**
 * recordTopic(cwd, fields) -> { file, space } — même résolution d'espace et
 * mêmes garde-fous que `calepin record` (secrets refusés, created préservé
 * sur mise à jour). fields: { topicPath, title, keywords, decisions, reasons,
 * facts, rules, files, links, narration, spaceLabel: 'equipe'|'perso'|null }.
 */
export function recordTopic(cwd, fields) {
  store.validateTopicPath(fields.topicPath);

  const scanned = [
    fields.title ?? '',
    (fields.keywords ?? []).join(','),
    ...(fields.decisions ?? []),
    ...(fields.reasons ?? []),
    ...(fields.facts ?? []),
    ...(fields.rules ?? []),
    fields.narration ?? '',
  ].join('\n');
  const secretHit = scanSecrets(scanned);
  if (secretHit) throw new Error(`secret détecté (motif: ${secretHit}) — record refusé`);

  const spaces = store.activeSpaces(cwd);
  let target;
  if (fields.spaceLabel === 'perso') {
    target = spaces.find((s) => s.label.startsWith('perso:'));
    if (!target) throw new Error('recordTopic: --space perso demandé mais aucun espace perso bindé');
  } else if (fields.spaceLabel === 'equipe') {
    target = spaces.find((s) => s.label === 'equipe');
    if (!target) throw new Error('recordTopic: --space equipe demandé mais pas de .calepin/ trouvé');
  } else {
    target = spaces.find((s) => s.label === 'equipe') ?? spaces.find((s) => s.label.startsWith('perso:'));
    if (!target) throw new Error('recordTopic: aucun espace actif (ni équipe ni perso bindé)');
  }

  const existingRaw = store.readTopic(target, fields.topicPath);
  const created = existingRaw ? parseTopic(existingRaw).created : todayISO();

  const obj = {
    title: fields.title,
    keywords: fields.keywords ?? [],
    created,
    updated: todayISO(),
    decisions: fields.decisions ?? [],
    reasons: fields.reasons ?? [],
    facts: fields.facts ?? [],
    rules: fields.rules ?? [],
    files: fields.files ?? [],
    links: fields.links ?? [],
    narration: fields.narration ?? '',
  };
  const file = store.writeTopic(target, fields.topicPath, obj);
  return { file, space: target.label };
}

// ---------------------------------------------------------------------------
// App plein écran `calepin ui` (voir docs/adr/0004 + refonte TUI vim-like) :
// tout ce qui décide QUOI faire vit ici (pur, testable sans TTY). src-ui/app.tsx
// ne fait que traduire les événements ink en dispatch(action) et exécuter les
// effets de bord demandés (pendingEffect) via les fonctions déjà exportées
// ci-dessus (queryMemory, runDreamAnalysis, recordTopic, applyMerge/Link/Prune).

const DOUBLE_KEY_TIMEOUT_MS = 400;

/** clampCursor(cursor, length) -> index valide dans [0, length-1] (0 si vide). */
export function clampCursor(cursor, length) {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(cursor, length - 1));
}

/** moveCursor(cursor, length, delta) -> clampCursor(cursor + delta, length). */
export function moveCursor(cursor, length, delta) {
  return clampCursor(cursor + delta, length);
}

/** [{namespace, start}] : index de départ de chaque groupe dans la liste à plat. */
export function namespaceStarts(groups) {
  const starts = [];
  let idx = 0;
  for (const g of groups) {
    starts.push(idx);
    idx += g.items.length;
  }
  return starts;
}

/** jumpNamespace(groups, cursor, direction) -> index du début du namespace précédent/suivant (1|-1). */
export function jumpNamespace(groups, cursor, direction) {
  const starts = namespaceStarts(groups);
  if (starts.length === 0) return 0;
  if (direction > 0) {
    return starts.find((s) => s > cursor) ?? starts[starts.length - 1];
  }
  const before = starts.filter((s) => s < cursor);
  return before.length ? before[before.length - 1] : starts[0];
}

/** halfPageSize(viewportRows) -> nombre de lignes pour Ctrl-d/Ctrl-u (>= 1). */
export function halfPageSize(viewportRows) {
  return Math.max(1, Math.floor(viewportRows / 2));
}

/**
 * trackDoubleKey(pending, key, now, timeoutMs=400) -> { pending, triggered }
 * Détecte une double frappe (dd, gg) dans une fenêtre de temps. pending:
 * {key, at} | null (état précédent). triggered=true -> 2e frappe reçue à temps,
 * pending redevient null. Sinon pending mémorise la 1ère frappe.
 */
export function trackDoubleKey(pending, key, now, timeoutMs = DOUBLE_KEY_TIMEOUT_MS) {
  if (pending && pending.key === key && now - pending.at <= timeoutMs) {
    return { pending: null, triggered: true };
  }
  return { pending: { key, at: now }, triggered: false };
}

/** { groups, flat } : groupByNamespace(filterTopics(topics, query)) + liste à plat. */
export function visibleList(topics, query) {
  const filtered = filterTopics(topics, query);
  const groups = groupByNamespace(filtered);
  return { groups, flat: groups.flatMap((g) => g.items) };
}

export const COMMAND_NAMES = ['q', 'help', 'new', 'dream', 'spaces', 'bind', 'sync', 'rm'];

/** parseCommandLine(":dream merge") -> { name: "dream", arg: "merge" }. Trim des 2 côtés. */
export function parseCommandLine(line) {
  const trimmed = String(line ?? '').trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) return { name: trimmed, arg: '' };
  return { name: trimmed.slice(0, spaceIdx), arg: trimmed.slice(spaceIdx + 1).trim() };
}

/** completeCommandName(prefix) -> seul nom de COMMAND_NAMES qui commence par prefix, sinon prefix inchangé. */
export function completeCommandName(prefix) {
  if (!prefix) return prefix;
  const matches = COMMAND_NAMES.filter((n) => n.startsWith(prefix));
  return matches.length === 1 ? matches[0] : prefix;
}

/** État initial du reducer de l'app plein écran. */
export function createInitialState(cwd) {
  return {
    cwd,
    topics: [],
    mode: 'NORMAL', // 'NORMAL' | 'SEARCH' | 'COMMAND'
    cmdline: '',
    query: '', // filtre lexical live pendant la frappe en mode SEARCH (avant Enter)
    searchPhase: null, // null | 'typing' | 'results'
    searchResults: null,
    citationBlock: '',
    cursor: 0,
    focus: 'list', // 'list' | 'preview'
    previewScroll: 0,
    fullscreen: false,
    overlay: null, // null | { type: 'help' | 'new' | 'dream' | 'spaces', ...opts }
    message: null, // { kind: 'info' | 'error', text } | null
    pendingKey: null, // { key, at } — détection dd/gg
    commandHistory: [],
    historyIndex: null,
    confirm: null, // { message, action } | null
    pendingEffect: null, // action à exécuter par app.tsx (effet de bord)
    busy: false,
  };
}

/**
 * deriveView(state) -> { resultsMode, groups, flat, hits, length, current }
 * Sélecteur central : ce qui est affiché dans la liste/preview selon l'état
 * courant (liste groupée par namespace, ou résultats de recherche scorés).
 */
export function deriveView(state) {
  if (state.mode === 'SEARCH' && state.searchPhase === 'results') {
    const hits = state.searchResults ?? [];
    const cursor = clampCursor(state.cursor, hits.length);
    return { resultsMode: true, groups: [], flat: [], hits, length: hits.length, current: hits[cursor] ?? null };
  }
  const query = state.mode === 'SEARCH' && state.searchPhase === 'typing' ? state.query : '';
  const { groups, flat } = visibleList(state.topics, query);
  const cursor = clampCursor(state.cursor, flat.length);
  return { resultsMode: false, groups, flat, hits: [], length: flat.length, current: flat[cursor] ?? null };
}

function navKeyToAction(input, key, state, now) {
  if (state.focus === 'preview') {
    if (input === 'j' || key.downArrow) return { type: 'PREVIEW_SCROLL', delta: 1 };
    if (input === 'k' || key.upArrow) return { type: 'PREVIEW_SCROLL', delta: -1 };
    if (key.tab) return { type: 'SET_FOCUS', focus: 'list' };
    return null;
  }
  if (input === 'j' || key.downArrow) return { type: 'MOVE_CURSOR', delta: 1 };
  if (input === 'k' || key.upArrow) return { type: 'MOVE_CURSOR', delta: -1 };
  if (input === 'G') return { type: 'JUMP_BOTTOM' };
  if (input === 'g') {
    const { pending, triggered } = trackDoubleKey(state.pendingKey, 'g', now);
    return triggered ? { type: 'JUMP_TOP' } : { type: 'SET_PENDING_KEY', pending };
  }
  if (key.ctrl && input === 'd') return { type: 'HALF_PAGE', direction: 1 };
  if (key.ctrl && input === 'u') return { type: 'HALF_PAGE', direction: -1 };
  if (input === '}') return { type: 'JUMP_NAMESPACE', direction: 1 };
  if (input === '{') return { type: 'JUMP_NAMESPACE', direction: -1 };
  if (key.tab) return { type: 'SET_FOCUS', focus: 'preview' };
  return null;
}

function normalOnlyKeyToAction(input, key, state, now) {
  if (key.return) return { type: 'ENTER_FULLSCREEN' };
  if (input === 'd') {
    const { pending, triggered } = trackDoubleKey(state.pendingKey, 'd', now);
    return triggered ? { type: 'REQUEST_DELETE' } : { type: 'SET_PENDING_KEY', pending };
  }
  if (input === 'y') return { type: 'COPY_PATH' };
  if (input === 'r') return { type: 'RELOAD' };
  if (input === '/') return { type: 'ENTER_SEARCH' };
  if (input === ':') return { type: 'ENTER_COMMAND' };
  if (input === '?') return { type: 'OPEN_OVERLAY', overlay: 'help' };
  if (input === 'q') return { type: 'REQUEST_QUIT' };
  return null;
}

/**
 * keyToAction(state, input, key, now) -> action | null
 * Traduit une frappe brute ink (input, key: {upArrow, downArrow, return,
 * escape, ctrl, tab, backspace, delete, meta, ...}) en action de reducer,
 * selon le mode courant. Pure — aucun accès TTY, testable directement.
 * N'est appelé par src-ui/app.tsx que quand aucun overlay n'est actif (les
 * overlays gèrent leurs propres touches localement).
 */
export function keyToAction(state, input, key, now) {
  if (state.fullscreen) {
    if (input === 'q' || key.escape || key.return) return { type: 'EXIT_FULLSCREEN' };
    if (input === 'j' || key.downArrow) return { type: 'PREVIEW_SCROLL', delta: 1 };
    if (input === 'k' || key.upArrow) return { type: 'PREVIEW_SCROLL', delta: -1 };
    return null;
  }

  if (state.confirm) {
    if (input === 'y' || input === 'Y') return { type: 'CONFIRM_YES' };
    if (input === 'n' || input === 'N' || key.escape) return { type: 'CONFIRM_NO' };
    return null;
  }

  if (state.mode === 'SEARCH' && state.searchPhase === 'results') {
    if (key.escape) return { type: 'CMDLINE_CANCEL' };
    if (input === 'c') return { type: 'COPY_CITATION' };
    if (key.return) return { type: 'ENTER_FULLSCREEN' };
    return navKeyToAction(input, key, state, now);
  }

  if (state.mode === 'SEARCH' || state.mode === 'COMMAND') {
    if (key.escape) return { type: 'CMDLINE_CANCEL' };
    if (key.return) return { type: 'CMDLINE_SUBMIT' };
    if (key.backspace || key.delete) return { type: 'CMDLINE_BACKSPACE' };
    if (key.tab && state.mode === 'COMMAND') return { type: 'CMDLINE_TAB' };
    if (key.upArrow && state.mode === 'COMMAND') return { type: 'CMDLINE_HISTORY', direction: -1 };
    if (key.downArrow && state.mode === 'COMMAND') return { type: 'CMDLINE_HISTORY', direction: 1 };
    if (input && !key.ctrl && !key.meta) return { type: 'CMDLINE_INPUT', char: input };
    return null;
  }

  return navKeyToAction(input, key, state, now) ?? normalOnlyKeyToAction(input, key, state, now);
}

function dispatchCommand(state, name, arg) {
  switch (name) {
    case '':
      return state;
    case 'q':
      return { ...state, busy: true, pendingEffect: { type: 'QUIT' } };
    case 'help':
      return { ...state, overlay: { type: 'help' } };
    case 'new':
      return { ...state, overlay: { type: 'new' } };
    case 'spaces':
      return { ...state, overlay: { type: 'spaces' } };
    case 'dream':
      if (!DREAM_MODES.includes(arg)) {
        return { ...state, message: { kind: 'error', text: `dream: mode inconnu "${arg}" (${DREAM_MODES.join('|')})` } };
      }
      return { ...state, overlay: { type: 'dream', mode: arg } };
    case 'bind':
      if (!arg) return { ...state, message: { kind: 'error', text: 'bind: nom requis (:bind <nom>)' } };
      return { ...state, busy: true, pendingEffect: { type: 'BIND', name: arg } };
    case 'sync':
      return { ...state, busy: true, pendingEffect: { type: 'SYNC', name: arg || null } };
    case 'rm':
      if (!arg) return { ...state, message: { kind: 'error', text: 'rm: chemin requis (:rm <space/path>)' } };
      return { ...state, confirm: { message: `supprimer ${arg} ? (y/n)`, action: { type: 'REMOVE_KEY', key: arg } } };
    default:
      return { ...state, message: { kind: 'error', text: `commande inconnue: "${name}"` } };
  }
}

/**
 * uiReducer(state, action) -> state
 * Reducer central de l'app plein écran (mode, curseur, filtre, résultats,
 * overlay actif, message). Les effets de bord (query, record, remove, sync,
 * bind, copie presse-papier, quit) sont demandés via `pendingEffect` — c'est
 * src-ui/app.tsx qui les exécute puis dispatch EFFECT_RESULT avec le patch.
 */
export function uiReducer(state, action) {
  switch (action.type) {
    case 'TOPICS_LOADED': {
      const { flat } = visibleList(action.topics, '');
      return { ...state, topics: action.topics, cursor: clampCursor(state.cursor, flat.length) };
    }
    case 'SET_FOCUS':
      return { ...state, focus: action.focus };
    case 'MOVE_CURSOR':
      return { ...state, cursor: moveCursor(state.cursor, deriveView(state).length, action.delta), pendingKey: null };
    case 'JUMP_TOP':
      return { ...state, cursor: 0 };
    case 'JUMP_BOTTOM':
      return { ...state, cursor: Math.max(0, deriveView(state).length - 1) };
    case 'JUMP_NAMESPACE': {
      const view = deriveView(state);
      if (view.resultsMode) return state;
      return { ...state, cursor: jumpNamespace(view.groups, state.cursor, action.direction) };
    }
    case 'HALF_PAGE': {
      const step = halfPageSize(action.viewportRows ?? 20) * action.direction;
      return { ...state, cursor: moveCursor(state.cursor, deriveView(state).length, step) };
    }
    case 'SET_PENDING_KEY':
      return { ...state, pendingKey: action.pending };
    case 'ENTER_FULLSCREEN':
      return deriveView(state).current ? { ...state, fullscreen: true, previewScroll: 0 } : state;
    case 'EXIT_FULLSCREEN':
      return { ...state, fullscreen: false, previewScroll: 0 };
    case 'PREVIEW_SCROLL':
      return { ...state, previewScroll: Math.max(0, state.previewScroll + action.delta) };
    case 'ENTER_SEARCH':
      return { ...state, mode: 'SEARCH', cmdline: '', query: '', searchPhase: 'typing', searchResults: null, cursor: 0, message: null };
    case 'ENTER_COMMAND':
      return { ...state, mode: 'COMMAND', cmdline: '', historyIndex: null, message: null };
    case 'CMDLINE_INPUT': {
      const cmdline = state.cmdline + action.char;
      if (state.mode === 'SEARCH' && state.searchPhase === 'typing') {
        return { ...state, cmdline, query: cmdline, cursor: 0 };
      }
      return { ...state, cmdline };
    }
    case 'CMDLINE_BACKSPACE': {
      const cmdline = state.cmdline.slice(0, -1);
      if (state.mode === 'SEARCH' && state.searchPhase === 'typing') {
        return { ...state, cmdline, query: cmdline, cursor: 0 };
      }
      return { ...state, cmdline };
    }
    case 'CMDLINE_CANCEL':
      return {
        ...state,
        mode: 'NORMAL',
        cmdline: '',
        query: '',
        searchPhase: null,
        searchResults: null,
        historyIndex: null,
        cursor: 0,
      };
    case 'CMDLINE_TAB': {
      if (state.mode !== 'COMMAND') return state;
      const { name, arg } = parseCommandLine(state.cmdline);
      const completed = completeCommandName(name);
      return { ...state, cmdline: arg ? `${completed} ${arg}` : completed };
    }
    case 'CMDLINE_HISTORY': {
      if (state.commandHistory.length === 0) return state;
      if (state.historyIndex === null) {
        if (action.direction > 0) return state;
        const idx = state.commandHistory.length - 1;
        return { ...state, cmdline: state.commandHistory[idx], historyIndex: idx };
      }
      const idx = state.historyIndex + action.direction;
      if (idx < 0) return state;
      if (idx >= state.commandHistory.length) return { ...state, cmdline: '', historyIndex: null };
      return { ...state, cmdline: state.commandHistory[idx], historyIndex: idx };
    }
    case 'CMDLINE_SUBMIT': {
      if (state.mode === 'SEARCH') {
        const question = state.cmdline.trim();
        if (!question) return { ...state, mode: 'NORMAL', searchPhase: null, query: '', cmdline: '' };
        return { ...state, busy: true, pendingEffect: { type: 'RUN_QUERY', question } };
      }
      const line = state.cmdline;
      const commandHistory = line.trim() ? [...state.commandHistory, line] : state.commandHistory;
      const { name, arg } = parseCommandLine(line);
      const next = { ...state, mode: 'NORMAL', cmdline: '', commandHistory, historyIndex: null };
      return dispatchCommand(next, name, arg);
    }
    case 'REQUEST_DELETE': {
      const view = deriveView(state);
      if (view.resultsMode || !view.current) return { ...state, pendingKey: null };
      const key = `${view.current.space}/${view.current.path}`;
      return { ...state, pendingKey: null, confirm: { message: `supprimer ${key} ? (y/n)`, action: { type: 'REMOVE_KEY', key } } };
    }
    case 'REQUEST_QUIT':
      return state.busy
        ? { ...state, confirm: { message: 'une opération est en cours, quitter quand même ? (y/n)', action: { type: 'QUIT' } } }
        : { ...state, busy: true, pendingEffect: { type: 'QUIT' } };
    case 'COPY_PATH':
      return { ...state, busy: true, pendingEffect: { type: 'COPY_PATH' } };
    case 'COPY_CITATION':
      return { ...state, busy: true, pendingEffect: { type: 'COPY_CITATION' } };
    case 'RELOAD':
      return { ...state, busy: true, pendingEffect: { type: 'RELOAD' } };
    case 'CONFIRM_YES':
      return { ...state, confirm: null, busy: true, pendingEffect: state.confirm?.action ?? null };
    case 'CONFIRM_NO':
      return { ...state, confirm: null, busy: false };
    case 'OPEN_OVERLAY':
      return { ...state, overlay: { type: action.overlay }, message: null };
    case 'CLOSE_OVERLAY':
      return { ...state, overlay: null };
    case 'SET_MESSAGE':
      return { ...state, message: action.message };
    case 'EFFECT_RESULT':
      return { ...state, pendingEffect: null, busy: false, ...(action.patch ?? {}) };
    default:
      return state;
  }
}
