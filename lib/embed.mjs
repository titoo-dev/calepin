// Embeddings multilingues locaux (transformers.js) — voir docs/adr/0003.
// Import dynamique uniquement : le paquet peut être absent (fallback BM25),
// getEmbedder() ne doit jamais faire planter l'appelant.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { home } from './store.mjs';

const MODEL_ID = 'Xenova/multilingual-e5-small';

// ponytail: e5 tronque de toute façon à 512 tokens (~4 chars/token en
// moyenne) — couper large en amont évite d'envoyer des Ko inutiles au
// pipeline sans prétendre faire un vrai compte de tokens.
const MAX_CHARS = 1500;

let singleton = null; // Promise<{embed}|null>, mémoïsée — un seul chargement de pipeline par process.
let lastFailureReason = null;

/** Raison courte du dernier échec de chargement (pour le warning stderr), ou null. */
export function getEmbedderFailureReason() {
  return lastFailureReason;
}

/**
 * {embed(texts: string[]) -> Promise<Float32Array[]>} ou null si indisponible
 * (paquet absent, modèle injoignable hors-ligne, CALEPIN_NO_EMBED). Jamais
 * bloquant : toute erreur retombe sur null, jamais une exception qui remonte.
 */
export function getEmbedder() {
  if (singleton === null) singleton = loadEmbedder();
  return singleton;
}

async function loadEmbedder() {
  if (process.env.CALEPIN_NO_EMBED) {
    lastFailureReason = 'CALEPIN_NO_EMBED';
    return null;
  }
  try {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(home(), 'cache', 'models');
    const pipe = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
    return {
      async embed(texts) {
        const output = await pipe(texts, { pooling: 'mean', normalize: true });
        return output.tolist().map((v) => Float32Array.from(v));
      },
    };
  } catch (err) {
    lastFailureReason = err?.message ?? String(err);
    return null;
  }
}

/** Produit scalaire — vecteurs déjà normalisés par le pipeline (norme unitaire = cosinus). */
export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Texte à embedder pour un sujet : title + keywords + decisions + rules +
 * facts + reasons + narration, préfixé "passage: " (obligatoire E5), tronqué.
 */
export function topicText(obj) {
  const parts = [
    obj.title ?? '',
    (obj.keywords ?? []).join(' '),
    ...(obj.decisions ?? []),
    ...(obj.rules ?? []),
    ...(obj.facts ?? []),
    ...(obj.reasons ?? []),
    obj.narration ?? '',
  ].filter((p) => p.length > 0);
  return `passage: ${parts.join('\n')}`.slice(0, MAX_CHARS);
}

function cacheDir() {
  return path.join(home(), 'cache', 'embeddings');
}

function hashContent(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function cacheFile(hash) {
  return path.join(cacheDir(), `${hash}.json`);
}

function readCache(hash) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(hash), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * embedTopics(entries, embedder) -> Map "space/path" -> Float32Array.
 * entries = [{space, path, obj, raw}] ; cache par sha256(raw), n'embed que
 * les manquants (batch), invalide si le modèle en cache diffère de MODEL_ID.
 */
export async function embedTopics(entries, embedder) {
  const result = new Map();
  if (!embedder) return result;
  fs.mkdirSync(cacheDir(), { recursive: true });

  const toEmbed = [];
  for (const entry of entries) {
    const key = `${entry.space}/${entry.path}`;
    const hash = hashContent(entry.raw);
    const cached = readCache(hash);
    if (cached && cached.model === MODEL_ID) {
      result.set(key, Float32Array.from(cached.vector));
    } else {
      toEmbed.push({ key, hash, text: topicText(entry.obj) });
    }
  }

  if (toEmbed.length > 0) {
    const vectors = await embedder.embed(toEmbed.map((e) => e.text));
    for (let i = 0; i < toEmbed.length; i++) {
      const { key, hash } = toEmbed[i];
      const vector = vectors[i];
      result.set(key, vector);
      fs.writeFileSync(cacheFile(hash), JSON.stringify({ model: MODEL_ID, vector: Array.from(vector) }));
    }
  }

  return result;
}
