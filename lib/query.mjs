// Logique commune de `query` — partagée entre le mode in-process (calepin.mjs)
// et le daemon (lib/serve.mjs). Reparse le corpus à chaque appel (voir
// ponytail dans calepin.mjs) ; seul l'embedder et les caches de vecteurs sont
// chauds côté daemon.

import { parseTopic } from './format.mjs';
import * as store from './store.mjs';
import { search, hybridSearch, shouldCite, citationBlock } from './search.mjs';
import { getEmbedder, getEmbedderFailureReason, embedTopics, embedQuery } from './embed.mjs';
import { recordHits } from './hits.mjs';

/**
 * runQuery({cwd, question, limit, space, noEmbed}) -> { hits, query,
 *   should_cite, citation_block, mode }
 * noEmbed force le BM25 pour CET appel seulement, sans toucher à l'embedder
 * chaud du process (utile au daemon : chaque requête choisit son mode).
 */
export async function runQuery({ cwd, question, limit = 5, space = null, noEmbed = false }) {
  let spaces = store.activeSpaces(cwd);
  if (space) spaces = spaces.filter((s) => s.label === space);

  const topics = [];
  for (const sp of spaces) {
    for (const entry of store.listTopics(sp)) {
      const raw = store.readTopic(sp, entry.path);
      if (raw == null) continue;
      topics.push({ space: entry.space, path: entry.path, obj: parseTopic(raw), raw });
    }
  }

  let hits;
  let mode;
  const embedder = noEmbed ? null : await getEmbedder();
  if (embedder) {
    try {
      const queryVector = await embedQuery(question, embedder);
      const topicVectors = await embedTopics(topics, embedder);
      hits = hybridSearch(topics, question, { limit, queryVector, topicVectors });
      mode = 'hybrid';
    } catch (err) {
      process.stderr.write(`calepin: embeddings indisponibles (${err.message}), fallback BM25\n`);
      hits = search(topics, question, limit);
      mode = 'bm25';
    }
  } else {
    if (!noEmbed) {
      process.stderr.write(
        `calepin: embeddings indisponibles (${getEmbedderFailureReason() ?? 'raison inconnue'}), fallback BM25\n`
      );
    }
    hits = search(topics, question, limit);
    mode = 'bm25';
  }

  recordHits(hits);

  return {
    hits,
    query: question,
    should_cite: shouldCite(hits),
    citation_block: citationBlock(hits),
    mode,
  };
}
