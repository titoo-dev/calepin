#!/usr/bin/env node
// Benchmark comparatif retrieval — 3 systèmes sur le même corpus/questions.
// baseline-grep (substring naïf, ce que fait un agent sans outil mémoire),
// bm25 (calepin --no-embed, proxy retrieval lexical structuré ~Byterover),
// hybrid (calepin complet BM25+e5+RRF). Lecture seule de lib/ et calepin.mjs.
//
// Sortie : tableau markdown dans BENCHMARK.md (racine) + résumé stdout.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { parseTopic } from '../lib/format.mjs';
import { search, hybridSearch } from '../lib/search.mjs';
import { getEmbedder, embedTopics, getEmbedderFailureReason } from '../lib/embed.mjs';

const REPO_ROOT = path.join(import.meta.dirname, '..');
const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures-dream');
const QUESTIONS_FILE = path.join(import.meta.dirname, 'questions-bench.json');
const OUT_FILE = path.join(REPO_ROOT, 'BENCHMARK.md');
const METRIC_LIMIT = 5; // assez pour recall@1, recall@3 et MRR@5
const COLD_SAMPLES_INDICATIF = 5; // bm25/grep : spawn froid indicatif, pas les 30

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

// --- Système 1 : baseline-grep --------------------------------------------
// Substring case/accent-insensitive des mots de la query dans le texte brut
// (raw HTML du sujet, tel qu'un agent le verrait en grepant les fichiers).
// Score = nb de mots de la query matchés. Zéro poids par champ, zéro stopword.

function normalizeGrep(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function grepWords(query) {
  return normalizeGrep(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function baselineGrepSearch(topics, query, limit) {
  const words = grepWords(query);
  if (words.length === 0) return [];
  const scored = topics.map((t) => {
    const text = normalizeGrep(t.raw);
    const score = words.filter((w) => text.includes(w)).length;
    return { path: t.path, score };
  });
  return scored
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --- Métriques --------------------------------------------------------------

function computeMetrics(questions, hitsPerQuestion) {
  let r1 = 0;
  let r3 = 0;
  let mrrSum = 0;
  for (let i = 0; i < questions.length; i++) {
    const expected = questions[i].expected;
    const paths = hitsPerQuestion[i].map((h) => h.path);
    if (paths[0] === expected) r1++;
    if (paths.slice(0, 3).includes(expected)) r3++;
    const idx = paths.slice(0, 5).indexOf(expected);
    if (idx !== -1) mrrSum += 1 / (idx + 1);
  }
  const n = questions.length;
  return { recallAt1: r1 / n, recallAt3: r3 / n, mrrAt5: mrrSum / n };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function timeSync(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

async function timeAsync(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

// --- Spawn froid : corpus temporaire + vrai `node calepin.mjs query` --------
// Reproduit l'UX CLI réelle : `.calepin/topics/` = espace équipe découvert par
// présence, aucune modification de lib/ ou calepin.mjs, CALEPIN_HOME par
// défaut (réutilise le cache modèle réel de ~/.calepin/cache/models).

function makeTempCorpus() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-bench-'));
  const topicsDir = path.join(tmp, '.calepin', 'topics');
  fs.mkdirSync(topicsDir, { recursive: true });
  fs.cpSync(FIXTURES_DIR, topicsDir, {
    recursive: true,
    filter: (src) => !src.endsWith('attendus.json'),
  });
  return tmp;
}

function spawnQueryOnce(tmpDir, query, extraFlags) {
  const args = [path.join(REPO_ROOT, 'calepin.mjs'), 'query', query, '--limit', String(METRIC_LIMIT), ...extraFlags];
  const start = process.hrtime.bigint();
  const proc = spawnSync(process.execPath, args, { cwd: tmpDir, encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  if (proc.status !== 0) {
    throw new Error(`spawn froid a échoué (status ${proc.status}): ${proc.stderr}`);
  }
  return ms;
}

// --- Empreinte ---------------------------------------------------------------

function duSize(dirPath) {
  if (!fs.existsSync(dirPath)) return 'absent';
  try {
    return execSync(`du -sh "${dirPath}"`).toString().trim().split(/\s+/)[0];
  } catch {
    return 'erreur';
  }
}

function fmtPct(x) {
  return `${(x * 100).toFixed(0)}%`;
}

function fmtMs(x) {
  return `${x.toFixed(0)} ms`;
}

async function main() {
  const topics = loadFixtures();
  const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  console.log(`calepin bench: ${topics.length} sujets, ${questions.length} questions\n`);

  // --- Accuracy + latence in-process : baseline-grep -----------------------
  const grepLatencies = [];
  const grepHits = questions.map((q) => {
    const { result, ms } = timeSync(() => baselineGrepSearch(topics, q.query, METRIC_LIMIT));
    grepLatencies.push(ms);
    return result;
  });
  const grepMetrics = computeMetrics(questions, grepHits);

  // --- Accuracy + latence in-process : bm25 (calepin --no-embed) -----------
  const bm25Latencies = [];
  const bm25Hits = questions.map((q) => {
    const { result, ms } = timeSync(() => search(topics, q.query, METRIC_LIMIT));
    bm25Latencies.push(ms);
    return result;
  });
  const bm25Metrics = computeMetrics(questions, bm25Hits);

  // --- Accuracy + latence in-process "chaud" : hybrid (vrai modèle e5) -----
  const embedder = await getEmbedder();
  if (!embedder) {
    console.error(`embedder indisponible (${getEmbedderFailureReason() ?? 'raison inconnue'}) — bench hybrid impossible.`);
    process.exit(1);
  }
  console.log('embedder chargé, embedding des 60 sujets (cache réutilisé si présent)...');
  const topicVectors = await embedTopics(topics, embedder);

  const hybridWarmLatencies = [];
  const hybridHits = [];
  for (const q of questions) {
    const { result, ms } = await timeAsync(async () => {
      const [queryVector] = await embedder.embed([`query: ${q.query}`]);
      return hybridSearch(topics, q.query, { limit: METRIC_LIMIT, queryVector, topicVectors });
    });
    hybridWarmLatencies.push(ms);
    hybridHits.push(result);
  }
  const hybridMetrics = computeMetrics(questions, hybridHits);

  // --- Latence "froid process" : hybrid, un vrai spawn par question --------
  console.log(`spawn froid hybrid (${questions.length}x \`node calepin.mjs query\`, patience)...`);
  const tmpDir = makeTempCorpus();
  const hybridColdLatencies = [];
  try {
    for (const q of questions) {
      hybridColdLatencies.push(spawnQueryOnce(tmpDir, q.query, []));
    }

    // --- Latence "froid" indicative : bm25 et grep ------------------------
    console.log(`spawn froid bm25/grep (${COLD_SAMPLES_INDICATIF} échantillons indicatifs)...`);
    const bm25ColdSamples = [];
    for (let i = 0; i < COLD_SAMPLES_INDICATIF; i++) {
      bm25ColdSamples.push(spawnQueryOnce(tmpDir, questions[i % questions.length].query, ['--no-embed']));
    }

    const grepColdSamples = [];
    const grepScript = `
      const fs = require('fs');
      const path = require('path');
      const dir = process.argv[2];
      const query = process.argv[3];
      const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/\\p{M}/gu, '');
      const words = normalize(query).split(/[^a-z0-9]+/).filter((w) => w.length > 0);
      const results = [];
      const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.html')) {
            const text = normalize(fs.readFileSync(full, 'utf8'));
            const score = words.filter((w) => text.includes(w)).length;
            if (score > 0) results.push(score);
          }
        }
      };
      walk(dir);
      results.sort((a, b) => b - a);
    `;
    const topicsDir = path.join(tmpDir, '.calepin', 'topics');
    for (let i = 0; i < COLD_SAMPLES_INDICATIF; i++) {
      const q = questions[i % questions.length].query;
      const start = process.hrtime.bigint();
      spawnSync(process.execPath, ['-e', grepScript, '--', topicsDir, q], { encoding: 'utf8' });
      grepColdSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }

    // --- Empreinte ----------------------------------------------------------
    const nodeModulesSize = duSize(path.join(REPO_ROOT, 'node_modules'));
    const modelCacheSize = duSize(path.join(os.homedir(), '.calepin', 'cache', 'models'));
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const directDeps = Object.keys(pkg.dependencies ?? {}).length;

    // --- Rapport --------------------------------------------------------------
    const median = (arr) => percentile(arr, 50);

    const lines = [];
    lines.push('# BENCHMARK — retrieval calepin');
    lines.push('');
    lines.push(`Date : ${new Date().toISOString().slice(0, 10)}`);
    lines.push(
      `Corpus : eval/fixtures-dream/ — ${topics.length} sujets. Langues réelles : 58 sujets rédigés en français ` +
        `(vocabulaire technique anglais mêlé, normal en fr technique), 1 sujet intégralement en anglais ` +
        '(`architecture/database-sharding`) et son doublon volontaire en français ' +
        '(`architecture/postgres-sharding-workspace`, prévu pour le test dream `merge`, pas pour ce bench).'
    );
    lines.push(`Questions : eval/questions-bench.json — 30 questions, écrites avant lecture des scores.`);
    lines.push('');

    lines.push('## Rappel / précision (30 questions, top-5)');
    lines.push('');
    lines.push('| Système | recall@1 | recall@3 | MRR@5 |');
    lines.push('|---|---|---|---|');
    lines.push(`| baseline-grep | ${fmtPct(grepMetrics.recallAt1)} | ${fmtPct(grepMetrics.recallAt3)} | ${grepMetrics.mrrAt5.toFixed(2)} |`);
    lines.push(`| bm25 (\`--no-embed\`) | ${fmtPct(bm25Metrics.recallAt1)} | ${fmtPct(bm25Metrics.recallAt3)} | ${bm25Metrics.mrrAt5.toFixed(2)} |`);
    lines.push(`| hybrid (bm25+e5+rrf) | ${fmtPct(hybridMetrics.recallAt1)} | ${fmtPct(hybridMetrics.recallAt3)} | ${hybridMetrics.mrrAt5.toFixed(2)} |`);
    lines.push('');

    lines.push('## Latence par query (ms)');
    lines.push('');
    lines.push('| Système / condition | p50 | p95 | n |');
    lines.push('|---|---|---|---|');
    lines.push(`| baseline-grep — in-process | ${fmtMs(percentile(grepLatencies, 50))} | ${fmtMs(percentile(grepLatencies, 95))} | ${grepLatencies.length} |`);
    lines.push(`| baseline-grep — spawn froid (indicatif) | ${fmtMs(median(grepColdSamples))} | — | ${grepColdSamples.length} |`);
    lines.push(`| bm25 — in-process | ${fmtMs(percentile(bm25Latencies, 50))} | ${fmtMs(percentile(bm25Latencies, 95))} | ${bm25Latencies.length} |`);
    lines.push(`| bm25 — spawn froid (indicatif) | ${fmtMs(median(bm25ColdSamples))} | — | ${bm25ColdSamples.length} |`);
    lines.push(`| hybrid — in-process chaud | ${fmtMs(percentile(hybridWarmLatencies, 50))} | ${fmtMs(percentile(hybridWarmLatencies, 95))} | ${hybridWarmLatencies.length} |`);
    lines.push(`| hybrid — spawn froid (\`node calepin.mjs query\` réel) | ${fmtMs(percentile(hybridColdLatencies, 50))} | ${fmtMs(percentile(hybridColdLatencies, 95))} | ${hybridColdLatencies.length} |`);
    lines.push('');

    lines.push('## Empreinte');
    lines.push('');
    lines.push('| Mesure | Valeur |');
    lines.push('|---|---|');
    lines.push(`| Taille node_modules | ${nodeModulesSize} |`);
    lines.push(`| Cache modèle (\`~/.calepin/cache/models\`) | ${modelCacheSize} |`);
    lines.push(`| Dépendances directes (package.json) | ${directDeps} |`);
    lines.push('');

    lines.push('## Limites (honnêteté du bench)');
    lines.push('');
    lines.push('- **Byterover réel non mesurable** : produit cloud fermé, ce bench ne le compare pas — `bm25` est un *proxy* de son approche déclarée (retrieval lexical structuré, zéro LLM, champs indexés séparément), pas Byterover lui-même.');
    lines.push('- **Corpus synthétique** écrit par un agent (fixtures-dream/), pas un vrai projet — structure et style peuvent favoriser un retrieval structuré par champs (`<cal-*>`) plus qu\'un vrai repo hétérogène.');
    lines.push('- **Questions écrites par le même agent** que celui qui a conçu et lit ce corpus — biais de familiarité possible malgré la contrainte de paraphrase et l\'écriture avant lecture des scores.');
    lines.push('- **Corpus très majoritairement français** : le lot "cross-langue" et "anglais sur sujet anglais" repose presque entièrement sur un seul sujet réellement anglais (`architecture/database-sharding`) — la proportion cible du brief (~8 questions "en/en") n\'était pas atteignable telle quelle vu le corpus réel ; les questions ont été redistribuées vers "anglais → sujet français" (bucket bien couvert par le corpus) plutôt que dupliquées artificiellement sur la même cible.');
    lines.push('- **should_cite non mesuré ici** : ce bench mesure recall/MRR/latence/empreinte, pas les faux positifs de citation (voir `eval/run.mjs` pour ça).');
    lines.push('');

    fs.writeFileSync(OUT_FILE, lines.join('\n') + '\n');

    console.log('\n=== Résumé ===\n');
    console.log(lines.join('\n'));
    console.log(`\nÉcrit dans ${OUT_FILE}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main();
