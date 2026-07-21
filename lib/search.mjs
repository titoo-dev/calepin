// Tokenisation + BM25 maison + should_cite + citation_block.
// Voir docs/adr/0003 : BM25 seul en P1, fusion avec des embeddings en P2.

import { cosine } from './embed.mjs';

// Poids TF par champ (title/keywords comptent plus que la narration).
const FIELD_WEIGHTS = {
  title: 3,
  keywords: 3,
  decisions: 2,
  rules: 2,
  facts: 1,
  reasons: 1,
  files: 1,
  links: 1,
  narration: 1,
};

const BM25_K1 = 1.2;
const BM25_B = 0.75;

// Seuil de score BM25 à partir duquel une citation est jugée pertinente.
// ponytail: valeur choisie à l'oeil sur un petit corpus de test — à calibrer
// en P2 avec le jeu de 20 questions (voir PRD §11 risques).
export const SHOULD_CITE_MIN = 1.5;

// Seuil de cosinus (embeddings) à partir duquel une citation est jugée
// pertinente, alternative au seuil BM25 en mode hybride.
// ponytail: e5 compresse les similarités vers 0.7–0.95, à calibrer avec eval/.
export const COSINE_CITE_MIN = 0.85;

// Constante RRF (Reciprocal Rank Fusion) — 60 est le standard de la littérature.
const RRF_K = 60;

// ponytail: interrogatifs (what/comment/quel...) ajoutés après l'éval P2 —
// des questions en langage naturel les traînent partout, et sans ça un mot
// isolé comme "what" matche n'importe quel doc qui le contient ailleurs
// (faux should_cite sur des questions hors-sujet, vu dans eval/).
const STOPWORDS = new Set([
  // français
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'ou', 'est',
  'pour', 'dans', 'sur', 'avec', 'pas', 'ce', 'cette', 'ces', 'que', 'qui',
  'au', 'aux', 'se', 'sa', 'son', 'ses', 'en', 'par',
  'comment', 'pourquoi', 'quel', 'quelle', 'quels', 'quelles', 'quoi',
  // anglais
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'in', 'for', 'on',
  'with', 'not', 'this', 'that', 'it', 'as', 'be', 'are', 'was',
  'what', 'how', 'why', 'when', 'where', 'which', 'who', 'does', 'did',
]);

/** lowercase, strip accents, split non-alphanum, tokens >=2 chars, sans stopwords. */
export function tokenize(text) {
  const normalized = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return normalized
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function fieldTexts(obj) {
  return {
    title: obj.title ?? '',
    keywords: (obj.keywords ?? []).join(' '),
    decisions: (obj.decisions ?? []).join(' '),
    rules: (obj.rules ?? []).join(' '),
    facts: (obj.facts ?? []).join(' '),
    reasons: (obj.reasons ?? []).join(' '),
    files: (obj.files ?? []).join(' '),
    links: (obj.links ?? []).join(' '),
    narration: obj.narration ?? '',
  };
}

/** tf pondérée par champ + longueur pondérée du document. */
function buildDoc(topic) {
  const tf = new Map();
  let length = 0;
  const texts = fieldTexts(topic.obj);
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    for (const token of tokenize(texts[field])) {
      tf.set(token, (tf.get(token) ?? 0) + weight);
      length += weight;
    }
  }
  return { topic, tf, length };
}

function firstMatchingSnippet(obj, queryTokens) {
  const querySet = new Set(queryTokens);
  const candidates = [...(obj.decisions ?? []), ...(obj.rules ?? []), ...(obj.facts ?? [])];
  for (const text of candidates) {
    if (tokenize(text).some((t) => querySet.has(t))) {
      return text.slice(0, 200);
    }
  }
  const narration = obj.narration ?? '';
  if (tokenize(narration).some((t) => querySet.has(t))) {
    return narration.slice(0, 200);
  }
  return narration.slice(0, 200);
}

/**
 * search(topics, query, limit) -> [{space, path, title, score, snippet}]
 * topics: [{space, path, obj}] où obj = parseTopic(...).
 */
export function search(topics, query, limit = 5) {
  const queryTokens = tokenize(query);
  if (topics.length === 0 || queryTokens.length === 0) return [];

  const docs = topics.map(buildDoc);
  const N = docs.length;
  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / N;

  const uniqueQueryTokens = [...new Set(queryTokens)];
  const df = new Map();
  for (const token of uniqueQueryTokens) {
    let count = 0;
    for (const d of docs) if (d.tf.has(token)) count++;
    df.set(token, count);
  }

  const scored = docs.map((d) => {
    let score = 0;
    for (const token of uniqueQueryTokens) {
      const tf = d.tf.get(token) ?? 0;
      if (tf === 0) continue;
      const dfTerm = df.get(token);
      const idf = Math.log((N - dfTerm + 0.5) / (dfTerm + 0.5) + 1);
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / avgdl);
      score += idf * ((tf * (BM25_K1 + 1)) / denom);
    }
    return {
      space: d.topic.space,
      path: d.topic.path,
      title: d.topic.obj.title,
      score,
      snippet: firstMatchingSnippet(d.topic.obj, uniqueQueryTokens),
    };
  });

  return scored
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Un hit passe le seuil si son score BM25 seul dépasse SHOULD_CITE_MIN, ou
// (hits hybrides, champ .cosine présent) si son cosinus dépasse COSINE_CITE_MIN.
function passesThreshold(hit) {
  if (hit.cosine !== undefined) {
    return hit.bm25 >= SHOULD_CITE_MIN || hit.cosine >= COSINE_CITE_MIN;
  }
  return hit.score >= SHOULD_CITE_MIN;
}

export function shouldCite(hits) {
  return hits.length > 0 && passesThreshold(hits[0]);
}

export function citationBlock(hits) {
  return hits
    .filter(passesThreshold)
    .map((h) => `> Selon [${h.space}/${h.path}] — ${h.title}: ${h.snippet}`)
    .join('\n');
}

/**
 * hybridSearch(topics, query, { limit, queryVector, topicVectors }) ->
 *   [{space, path, title, score, bm25, cosine, snippet}]
 * Fusionne le ranking BM25 (existant) et le ranking cosinus par Reciprocal
 * Rank Fusion : score_rrf = Σ 1/(RRF_K + rang) sur les deux listes.
 * topicVectors : Map "space/path" -> Float32Array (voir lib/embed.mjs).
 */
export function hybridSearch(topics, query, { limit = 5, queryVector, topicVectors } = {}) {
  if (topics.length === 0) return [];
  const queryTokens = tokenize(query);

  const bm25Hits = search(topics, query, topics.length);
  const bm25Rank = new Map(); // "space/path" -> {rank, score}
  bm25Hits.forEach((h, i) => bm25Rank.set(`${h.space}/${h.path}`, { rank: i, score: h.score }));

  const cosineRank = new Map();
  if (queryVector && topicVectors) {
    const ranked = topics
      .map((t) => {
        const key = `${t.space}/${t.path}`;
        const vector = topicVectors.get(key);
        return vector ? { key, score: cosine(queryVector, vector) } : null;
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.score - a.score);
    ranked.forEach((r, i) => cosineRank.set(r.key, { rank: i, score: r.score }));
  }

  const byKey = new Map(topics.map((t) => [`${t.space}/${t.path}`, t]));
  const allKeys = new Set([...bm25Rank.keys(), ...cosineRank.keys()]);

  const fused = [...allKeys].map((key) => {
    const topic = byKey.get(key);
    const bm25Entry = bm25Rank.get(key);
    const cosineEntry = cosineRank.get(key);
    const rrfScore =
      (bm25Entry ? 1 / (RRF_K + bm25Entry.rank + 1) : 0) +
      (cosineEntry ? 1 / (RRF_K + cosineEntry.rank + 1) : 0);
    return {
      space: topic.space,
      path: topic.path,
      title: topic.obj.title,
      score: rrfScore,
      bm25: bm25Entry ? bm25Entry.score : 0,
      cosine: cosineEntry ? cosineEntry.score : 0,
      snippet: firstMatchingSnippet(topic.obj, queryTokens),
    };
  });

  return fused.sort((a, b) => b.score - a.score).slice(0, limit);
}
