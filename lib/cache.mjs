// `calepin cache gc` — purge les caches locaux périmés par âge (mtime).
// ponytail: age-based, pas de tracking cross-repo des hashes — un vecteur
// re-calculable n'est jamais une perte.

import fs from 'node:fs';
import path from 'node:path';
import { home, activeSpaces, listTopics } from './store.mjs';
import { pruneOrphanHits } from './hits.mjs';

const CACHE_SUBDIRS = ['embeddings', 'queries'];

function purgeOldFiles(dir, maxAgeMs) {
  let filesRemoved = 0;
  let bytesFreed = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { filesRemoved, bytesFreed };
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    const stat = fs.statSync(file);
    if (now - stat.mtimeMs > maxAgeMs) {
      bytesFreed += stat.size;
      fs.unlinkSync(file);
      filesRemoved++;
    }
  }
  return { filesRemoved, bytesFreed };
}

function personalSpaces() {
  const dir = path.join(home(), 'spaces');
  let names;
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.map((name) => ({ label: `perso:${name}`, root: path.join(dir, name) }));
}

/**
 * gc(maxAgeDays, cwd) -> { filesRemoved, bytesFreed, hitsRemoved }
 * Purge cache/embeddings + cache/queries plus vieux que maxAgeDays (mtime),
 * et les entrées hits.json dont le sujet n'existe plus dans les espaces
 * visibles (cwd + tous les espaces perso, pas seulement ceux actifs pour ce
 * cwd — hits.json est global au perso, pas par projet).
 */
export function gc(maxAgeDays, cwd) {
  const maxAgeMs = maxAgeDays * 86400000;
  let filesRemoved = 0;
  let bytesFreed = 0;
  for (const sub of CACHE_SUBDIRS) {
    const res = purgeOldFiles(path.join(home(), 'cache', sub), maxAgeMs);
    filesRemoved += res.filesRemoved;
    bytesFreed += res.bytesFreed;
  }

  const existingKeys = new Set();
  for (const space of [...activeSpaces(cwd), ...personalSpaces()]) {
    for (const entry of listTopics(space)) {
      existingKeys.add(`${space.label}/${entry.path}`);
    }
  }

  const hitsRemoved = pruneOrphanHits(existingKeys);
  return { filesRemoved, bytesFreed, hitsRemoved };
}
