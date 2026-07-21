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

const DREAM_MODES = ['merge', 'link', 'prune', 'synthesize'];

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
