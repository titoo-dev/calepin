#!/usr/bin/env node
// Harnais de calibration du retrieval hybride — PRD §10 et §12, docs/adr/0003.
// Charge les fixtures directement (parseTopic, pas besoin d'espace/bind),
// tente l'embedder réel (télécharge le modèle au premier run — patience),
// rejoue eval/questions.json et calcule rappel + faux positifs/négatifs.

import fs from 'node:fs';
import path from 'node:path';
import { parseTopic } from '../lib/format.mjs';
import { search, hybridSearch, shouldCite } from '../lib/search.mjs';
import { getEmbedder, embedTopics, getEmbedderFailureReason } from '../lib/embed.mjs';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');
const QUESTIONS_FILE = path.join(import.meta.dirname, 'questions.json');

// Seuils de sortie PASS/FAIL — PRD §10.
const TOP3_RECALL_MIN = 0.8;
const FALSE_POSITIVE_MAX = 0.2;

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

async function main() {
  const topics = loadFixtures();
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  console.log(`calepin eval: ${topics.length} sujets, ${questions.length} questions`);

  const embedder = await getEmbedder();
  let topicVectors = null;
  if (embedder) {
    console.log('embedder chargé (téléchargement au premier run si pas encore en cache — patience)...');
    topicVectors = await embedTopics(topics, embedder);
  } else {
    console.log(
      `embedder indisponible (${getEmbedderFailureReason() ?? 'raison inconnue'}) — éval en BM25 seul, dégradée.`
    );
  }

  let top1Hits = 0;
  let top3Hits = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let onTopicCount = 0;
  let offTopicCount = 0;
  const missed = [];

  for (const q of questions) {
    let hits;
    if (embedder) {
      const [queryVector] = await embedder.embed([`query: ${q.query}`]);
      hits = hybridSearch(topics, q.query, { limit: 3, queryVector, topicVectors });
    } else {
      hits = search(topics, q.query, 3);
    }

    const top1 = hits[0]?.path ?? null;
    const top3Paths = hits.map((h) => h.path);
    const cite = shouldCite(hits);

    if (q.expected === null) {
      offTopicCount++;
      if (cite) falsePositives++;
    } else {
      onTopicCount++;
      const gotTop1 = top1 === q.expected;
      const gotTop3 = top3Paths.includes(q.expected);
      if (gotTop1) top1Hits++;
      if (gotTop3) top3Hits++;
      if (!cite) falseNegatives++;
      if (!gotTop3) missed.push({ query: q.query, expected: q.expected, got: top3Paths });
    }
  }

  const top1Recall = onTopicCount ? top1Hits / onTopicCount : 1;
  const top3Recall = onTopicCount ? top3Hits / onTopicCount : 1;
  const fpRate = offTopicCount ? falsePositives / offTopicCount : 0;
  const fnRate = onTopicCount ? falseNegatives / onTopicCount : 0;

  console.log(`\nrappel top-1: ${(top1Recall * 100).toFixed(0)}% (${top1Hits}/${onTopicCount})`);
  console.log(`rappel top-3: ${(top3Recall * 100).toFixed(0)}% (${top3Hits}/${onTopicCount})`);
  console.log(`should_cite faux positifs: ${(fpRate * 100).toFixed(0)}% (${falsePositives}/${offTopicCount})`);
  console.log(`should_cite faux négatifs: ${(fnRate * 100).toFixed(0)}% (${falseNegatives}/${onTopicCount})`);

  if (missed.length > 0) {
    console.log('\nquestions ratées (absentes du top-3):');
    for (const m of missed) {
      console.log(`  - "${m.query}"\n    attendu: ${m.expected} — obtenu: [${m.got.join(', ')}]`);
    }
  }

  const pass = top3Recall >= TOP3_RECALL_MIN && fpRate < FALSE_POSITIVE_MAX;
  console.log(`\n${pass ? 'PASS' : 'FAIL'}`);
  process.exit(pass ? 0 : 1);
}

main();
