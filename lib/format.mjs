// Parseur/sérialiseur du format <cal-*> (voir docs/adr/0002).
//
// ponytail: ce n'est pas un parseur HTML général — c'est un sous-ensemble
// strict, une balise cal-* (ou <p>) par ligne. Un vrai parseur HTML tolérant
// (imbrication, balises multi-lignes, commentaires) serait overkill pour un
// format qu'on émet nous-mêmes ; upgrade path si un jour des sujets sont
// édités à la main de façon plus libre.

const CHILD_TAGS = ['cal-decision', 'cal-reason', 'cal-fact', 'cal-rule', 'cal-file', 'cal-link'];

// pluriel utilisé dans l'objet parsé pour chaque balise enfant
const CHILD_FIELD = {
  'cal-decision': 'decisions',
  'cal-reason': 'reasons',
  'cal-fact': 'facts',
  'cal-rule': 'rules',
  'cal-file': 'files',
  'cal-link': 'links',
};

const OPEN_RE = /^<cal-topic\s+([^>]*)>$/;
const CLOSE_LINE = '</cal-topic>';
const CHILD_RE = new RegExp(`^<(${CHILD_TAGS.join('|')})>(.*)<\\/\\1>$`);
const UNKNOWN_CAL_RE = /^<\/?cal-[a-z-]+/;
const ATTR_RE = /([a-z]+)="([^"]*)"/g;
const STRIP_TAGS_RE = /<[^>]*>/g;

function escapeEntities(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function unescapeEntities(str) {
  return String(str)
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * parseTopic(html) -> { title, keywords[], created, updated, decisions[],
 *   reasons[], facts[], rules[], files[], links[], narration }
 * Jette une Error claire si structure invalide ou balise cal-* inconnue.
 */
export function parseTopic(html) {
  const lines = String(html)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('sujet vide : aucun élément trouvé');
  }

  const openMatch = OPEN_RE.exec(lines[0]);
  if (!openMatch) {
    throw new Error(`première ligne doit être <cal-topic ...> — reçu: "${lines[0]}"`);
  }
  const closeIdx = lines.length - 1;
  if (lines[closeIdx] !== CLOSE_LINE) {
    throw new Error(`dernière ligne doit être ${CLOSE_LINE} — reçu: "${lines[closeIdx]}"`);
  }

  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(openMatch[1])) !== null) {
    attrs[m[1]] = unescapeEntities(m[2]);
  }

  const result = {
    title: attrs.title ?? '',
    keywords: (attrs.keywords ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
    created: attrs.created ?? '',
    updated: attrs.updated ?? '',
    decisions: [],
    reasons: [],
    facts: [],
    rules: [],
    files: [],
    links: [],
    narration: '',
  };

  const narrationLines = [];

  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i];
    const childMatch = CHILD_RE.exec(line);
    if (childMatch) {
      const field = CHILD_FIELD[childMatch[1]];
      result[field].push(unescapeEntities(childMatch[2]));
      continue;
    }
    if (UNKNOWN_CAL_RE.test(line)) {
      throw new Error(`balise cal-* inconnue ou mal formée: "${line}"`);
    }
    // tout le reste = narration : strip des tags HTML, texte brut pour l'indexation
    const stripped = unescapeEntities(line.replace(STRIP_TAGS_RE, '')).trim();
    if (stripped.length > 0) {
      narrationLines.push(stripped);
    }
  }

  result.narration = narrationLines.join('\n');
  return result;
}

/**
 * serializeTopic(obj) -> HTML, un élément par ligne, indentation 2 espaces.
 */
export function serializeTopic(obj) {
  const lines = [];
  const attrs = [
    `title="${escapeEntities(obj.title ?? '')}"`,
    `keywords="${escapeEntities((obj.keywords ?? []).join(', '))}"`,
    `created="${escapeEntities(obj.created ?? '')}"`,
    `updated="${escapeEntities(obj.updated ?? '')}"`,
  ].join(' ');
  lines.push(`<cal-topic ${attrs}>`);

  const pushChildren = (tag, values) => {
    for (const v of values ?? []) {
      lines.push(`  <${tag}>${escapeEntities(v)}</${tag}>`);
    }
  };
  pushChildren('cal-decision', obj.decisions);
  pushChildren('cal-reason', obj.reasons);
  pushChildren('cal-fact', obj.facts);
  pushChildren('cal-rule', obj.rules);
  pushChildren('cal-file', obj.files);
  pushChildren('cal-link', obj.links);

  const narration = obj.narration ?? '';
  if (narration.length > 0) {
    for (const paragraph of narration.split('\n')) {
      if (paragraph.trim().length > 0) {
        lines.push(`  <p>${escapeEntities(paragraph)}</p>`);
      }
    }
  }

  lines.push(CLOSE_LINE);
  return lines.join('\n') + '\n';
}

const PRETTY_SECTIONS = [
  ['decisions', 'Décision'],
  ['reasons', 'Raison'],
  ['facts', 'Faits'],
  ['rules', 'Règles'],
  ['files', 'Fichiers'],
  ['links', 'Liens'],
];

/**
 * renderPretty(obj) -> texte terminal lisible d'un sujet déjà parsé
 * (parseTopic). Indentation simple, pas de dépendance couleur.
 */
export function renderPretty(obj) {
  const lines = [obj.title || '(sans titre)'];
  if ((obj.keywords ?? []).length > 0) {
    lines.push(`  mots-clés: ${obj.keywords.join(', ')}`);
  }
  if (obj.created) {
    const updated = obj.updated && obj.updated !== obj.created ? `, mis à jour: ${obj.updated}` : '';
    lines.push(`  créé: ${obj.created}${updated}`);
  }

  for (const [field, label] of PRETTY_SECTIONS) {
    const values = obj[field] ?? [];
    if (values.length === 0) continue;
    lines.push('', `${label}:`);
    for (const v of values) lines.push(`  - ${v}`);
  }

  if ((obj.narration ?? '').length > 0) {
    lines.push('', 'Narration:');
    for (const p of obj.narration.split('\n')) lines.push(`  ${p}`);
  }

  return lines.join('\n') + '\n';
}
