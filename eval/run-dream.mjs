#!/usr/bin/env node
// Harnais de calibration de dream — PRD §7 F4, §12 (points 4-5 de la phase P4).
// Charge eval/fixtures-dream/ (60 sujets, cas plantés documentés dans
// attendus.json), joue les 4 modes avec le vrai modèle d'embeddings (cache
// déjà téléchargé), mesure le rappel des cas plantés dans le top --limit.
// PASS si chaque mode retrouve >= 80% de ses cas plantés.

import fs from 'node:fs';
import path from 'node:path';
import { parseTopic } from '../lib/format.mjs';
import { dream } from '../lib/dream.mjs';
import { getEmbedder, embedTopics, getEmbedderFailureReason } from '../lib/embed.mjs';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures-dream');
const ATTENDUS_FILE = path.join(FIXTURES_DIR, 'attendus.json');
const LIMIT = 30;
const RECALL_MIN = 0.8;

function loadFixtures() {
  const topics = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.html')) {
        const slug = entry.name.slice(0, -'.html'.length);
        const topicPath = prefix ? `${prefix}/${slug}` : slug;
        const raw = fs.readFileSync(full, 'utf8');
        topics.push({ space: 'eval', path: topicPath, obj: parseTopic(raw), raw });
      }
    }
  };
  walk(FIXTURES_DIR, '');
  return topics;
}

// Compteurs de hits synthétiques : tout le corpus a été "consulté" sauf les
// sujets plantés comme morts (attendus.prune) — sans ça, un corpus de fixtures
// sans historique de query réel ferait passer TOUT le monde à 0 hit, un signal
// non discriminant pour cette éval.
function syntheticHits(topics, attendus) {
  const deadPaths = new Set(attendus.prune.flatMap((c) => c.paths));
  const hits = {};
  for (const t of topics) {
    if (!deadPaths.has(t.path)) {
      hits[`${t.space}/${t.path}`] = { count: 5, last: '2026-07-01' };
    }
  }
  return hits;
}

function setEq(a, b) {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((x) => setB.has(x));
}

function subset(needle, haystack) {
  const setH = new Set(haystack);
  return needle.every((x) => setH.has(x));
}

function evalMode(_mode, candidates, attendusForMode, matcher) {
  let found = 0;
  const missed = [];
  for (const expected of attendusForMode) {
    const expectedKeys = expected.paths.map((p) => `eval/${p}`);
    const hit = candidates.some((c) => matcher(expectedKeys, c.paths));
    if (hit) found++;
    else missed.push(expected.paths);
  }
  const extras = candidates.filter(
    (c) => !attendusForMode.some((expected) => matcher(expected.paths.map((p) => `eval/${p}`), c.paths))
  );
  return { found, total: attendusForMode.length, missed, extras: extras.length };
}

async function main() {
  const topics = loadFixtures();
  const attendus = JSON.parse(fs.readFileSync(ATTENDUS_FILE, 'utf8'));
  console.log(`calepin eval:dream: ${topics.length} sujets`);

  const embedder = await getEmbedder();
  let topicVectors = null;
  if (embedder) {
    console.log('embedder chargé...');
    topicVectors = await embedTopics(topics, embedder);
  } else {
    console.log(
      `embedder indisponible (${getEmbedderFailureReason() ?? 'raison inconnue'}) — éval en Jaccard seul, dégradée.`
    );
  }

  const hits = syntheticHits(topics, attendus);

  const modes = [
    { mode: 'merge', matcher: setEq },
    { mode: 'link', matcher: setEq },
    { mode: 'prune', matcher: setEq },
    { mode: 'synthesize', matcher: subset },
  ];

  let allPass = true;
  for (const { mode, matcher } of modes) {
    const { candidates } = dream(topics, { mode, limit: LIMIT, topicVectors, hits });
    const result = evalMode(mode, candidates, attendus[mode], matcher);
    const recall = result.total ? result.found / result.total : 1;
    const pass = recall >= RECALL_MIN;
    allPass = allPass && pass;
    console.log(
      `\n${mode}: rappel ${(recall * 100).toFixed(0)}% (${result.found}/${result.total}), candidats hors-attendus: ${result.extras} — ${pass ? 'PASS' : 'FAIL'}`
    );
    if (result.missed.length > 0) {
      console.log('  cas plantés ratés:');
      for (const m of result.missed) console.log(`    - ${m.join(' <-> ')}`);
    }
  }

  console.log(`\n${allPass ? 'PASS' : 'FAIL'}`);
  process.exit(allPass ? 0 : 1);
}

main();
