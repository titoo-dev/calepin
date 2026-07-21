// Compteurs de hits query — signal local pour `dream --mode prune`.
// ponytail: stats locales par utilisateur, pas committées — signal prune
// perso, suffisant (pas de fusion multi-machines, pas de format versionné).

import fs from 'node:fs';
import path from 'node:path';
import { home } from './store.mjs';

function hitsFile() {
  return path.join(home(), 'cache', 'hits.json');
}

/** { "<space>/<path>": { count, last } } — lecture corrompue/absente -> objet vide. */
export function loadHits() {
  try {
    return JSON.parse(fs.readFileSync(hitsFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** Incrémente le compteur de chaque hit ("space/path"). Jamais bloquant : échec silencieux. */
export function recordHits(hits) {
  try {
    const data = loadHits();
    const today = new Date().toISOString().slice(0, 10);
    for (const hit of hits) {
      const key = `${hit.space}/${hit.path}`;
      const entry = data[key] ?? { count: 0, last: today };
      entry.count += 1;
      entry.last = today;
      data[key] = entry;
    }
    fs.mkdirSync(path.dirname(hitsFile()), { recursive: true });
    fs.writeFileSync(hitsFile(), JSON.stringify(data, null, 2) + '\n');
  } catch {
    // silencieux : les stats de hits ne doivent jamais faire échouer une query.
  }
}

/** Supprime l'entrée hits.json d'un sujet retiré ("space/path"). Jamais bloquant. */
export function removeHit(key) {
  try {
    const data = loadHits();
    if (!(key in data)) return;
    delete data[key];
    fs.mkdirSync(path.dirname(hitsFile()), { recursive: true });
    fs.writeFileSync(hitsFile(), JSON.stringify(data, null, 2) + '\n');
  } catch {
    // silencieux, même contrat que recordHits.
  }
}

/** Supprime les entrées hits.json dont la clé n'est pas dans existingKeys (Set). -> nombre supprimé. */
export function pruneOrphanHits(existingKeys) {
  try {
    const data = loadHits();
    let removed = 0;
    for (const key of Object.keys(data)) {
      if (!existingKeys.has(key)) {
        delete data[key];
        removed++;
      }
    }
    if (removed > 0) {
      fs.mkdirSync(path.dirname(hitsFile()), { recursive: true });
      fs.writeFileSync(hitsFile(), JSON.stringify(data, null, 2) + '\n');
    }
    return removed;
  } catch {
    return 0;
  }
}
