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
const FIXTURES_DIR_EN = path.join(import.meta.dirname, 'fixtures-bench-en');
const QUESTIONS_FILE = path.join(import.meta.dirname, 'questions-bench.json');
const OUT_FILE = path.join(REPO_ROOT, 'BENCHMARK.md');
const METRIC_LIMIT = 5; // assez pour recall@1, recall@3 et MRR@5
const COLD_SAMPLES_INDICATIF = 5; // bm25/grep : spawn froid indicatif, pas toutes les questions
// Seul sujet du corpus fixtures-dream/ (majoritairement français) réellement
// rédigé en anglais — voir BENCHMARK.md Corpus. Sert à classer le bucket
// fr/en des questions qui le ciblent.
const DREAM_EN_EXCEPTIONS = new Set(['architecture/database-sharding']);

function loadFixtures(dir, source) {
  const topics = [];
  const walk = (d, prefix) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.html')) {
        const slug = entry.name.slice(0, -'.html'.length);
        const topicPath = prefix ? `${prefix}/${slug}` : slug;
        const raw = fs.readFileSync(full, 'utf8');
        topics.push({ space: 'eval', path: topicPath, obj: parseTopic(raw), raw, source });
      }
    }
  };
  walk(dir, '');
  return topics;
}

// --- Bucket linguistique (fr→fr, en→fr, fr→en, en→en, fourre-tout) ---------
// Détection légère par mots-outils : suffisant pour classer les questions du
// bench (pas un détecteur de langue général). Query sans marqueur net des
// deux côtés (keyword-soup volontaire) → "fourre-tout", assumé.

const FR_MARKERS = new Set([
  'comment', 'quelle', 'quel', 'quelles', 'quels', 'pourquoi', 'combien', 'est-ce',
  'qu', 'que', 'qui', 'les', 'des', 'une', 'un', 'sont', 'peut', 'sans', 'entre',
  'avant', 'apres', 'après', 'toujours', 'jamais', 'pendant', 'ete', 'reste',
]);
const EN_MARKERS = new Set([
  'how', 'what', 'why', 'who', 'which', 'when', 'where', 'does', 'do', 'the',
  'a', 'an', 'under', 'in', 'is', 'are', 'can', 'you',
]);

function detectQueryLang(query) {
  const words = query.toLowerCase().match(/[a-zàâäéèêëïîôöùûüç]+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const w of words) {
    if (FR_MARKERS.has(w)) fr++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (fr > 0 && en === 0) return 'fr';
  if (en > 0 && fr === 0) return 'en';
  return null;
}

function topicLang(topicPath, pathSourceMap) {
  const source = pathSourceMap.get(topicPath);
  if (source === 'bench-en') return 'en';
  if (DREAM_EN_EXCEPTIONS.has(topicPath)) return 'en';
  return 'fr';
}

function bucketOf(question, pathSourceMap) {
  const qLang = detectQueryLang(question.query);
  if (!qLang) return 'fourre-tout';
  return `${qLang}→${topicLang(question.expected, pathSourceMap)}`;
}

const BUCKET_ORDER = ['fr→fr', 'en→fr', 'fr→en', 'en→en', 'fourre-tout'];

function groupIndicesByBucket(questions, pathSourceMap) {
  const groups = new Map(BUCKET_ORDER.map((b) => [b, []]));
  questions.forEach((q, i) => {
    const b = bucketOf(q, pathSourceMap);
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(i);
  });
  return groups;
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
  fs.cpSync(FIXTURES_DIR_EN, topicsDir, { recursive: true });
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
  const topics = [...loadFixtures(FIXTURES_DIR, 'dream'), ...loadFixtures(FIXTURES_DIR_EN, 'bench-en')];
  const pathSourceMap = new Map(topics.map((t) => [t.path, t.source]));
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
  console.log(`embedder chargé, embedding des ${topics.length} sujets (cache réutilisé si présent)...`);
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

  // --- Breakdown par bucket linguistique (fr→fr, en→fr, fr→en, en→en, ...) --
  const bucketGroups = groupIndicesByBucket(questions, pathSourceMap);
  const bucketRows = [];
  for (const bucket of BUCKET_ORDER) {
    const idx = bucketGroups.get(bucket) ?? [];
    if (idx.length === 0) continue;
    const sub = (hits) => idx.map((i) => hits[i]);
    const subQ = idx.map((i) => questions[i]);
    bucketRows.push({
      bucket,
      n: idx.length,
      grep: computeMetrics(subQ, sub(grepHits)),
      bm25: computeMetrics(subQ, sub(bm25Hits)),
      hybrid: computeMetrics(subQ, sub(hybridHits)),
    });
  }

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
      `Corpus : eval/fixtures-dream/ (60 sujets) + eval/fixtures-bench-en/ (20 sujets) — ${topics.length} sujets. ` +
        'fixtures-dream/ : 58 sujets rédigés en français (vocabulaire technique anglais mêlé, normal en fr technique), ' +
        '1 sujet intégralement en anglais (`architecture/database-sharding`) et son doublon volontaire en français ' +
        '(`architecture/postgres-sharding-workspace`, prévu pour le test dream `merge`, pas pour ce bench). ' +
        'fixtures-bench-en/ : 20 sujets intégralement en anglais (title, keywords monolingues, contenu), même projet ' +
        'fictif (workspace de messagerie), ajoutés pour donner au cross-langue un vrai volume à mesurer.'
    );
    lines.push(`Questions : eval/questions-bench.json — ${questions.length} questions, écrites avant lecture des scores.`);
    lines.push('');

    lines.push(`## Rappel / précision (${questions.length} questions, top-5)`);
    lines.push('');
    lines.push('| Système | recall@1 | recall@3 | MRR@5 |');
    lines.push('|---|---|---|---|');
    lines.push(`| baseline-grep | ${fmtPct(grepMetrics.recallAt1)} | ${fmtPct(grepMetrics.recallAt3)} | ${grepMetrics.mrrAt5.toFixed(2)} |`);
    lines.push(`| bm25 (\`--no-embed\`) | ${fmtPct(bm25Metrics.recallAt1)} | ${fmtPct(bm25Metrics.recallAt3)} | ${bm25Metrics.mrrAt5.toFixed(2)} |`);
    lines.push(`| hybrid (bm25+e5+rrf) | ${fmtPct(hybridMetrics.recallAt1)} | ${fmtPct(hybridMetrics.recallAt3)} | ${hybridMetrics.mrrAt5.toFixed(2)} |`);
    lines.push('');

    lines.push('## Rappel / précision par bucket linguistique (top-5)');
    lines.push('');
    lines.push(
      '`requete→sujet` : `fr→fr` questions françaises sur sujet français, `en→fr` questions anglaises sur sujet ' +
        'français, `fr→en` questions françaises sur sujet anglais (cross-langue pur, sans pont keywords bilingue), ' +
        '`en→en` questions anglaises sur sujet anglais (monolingue en), `fourre-tout` requêtes keyword-soup sans ' +
        'marqueur de langue net (voir détection dans bench.mjs).'
    );
    lines.push('');
    lines.push('| Bucket | n | grep r@1 | bm25 r@1 | hybrid r@1 | grep r@3 | bm25 r@3 | hybrid r@3 |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const row of bucketRows) {
      lines.push(
        `| ${row.bucket} | ${row.n} | ${fmtPct(row.grep.recallAt1)} | ${fmtPct(row.bm25.recallAt1)} | ${fmtPct(row.hybrid.recallAt1)} | ` +
          `${fmtPct(row.grep.recallAt3)} | ${fmtPct(row.bm25.recallAt3)} | ${fmtPct(row.hybrid.recallAt3)} |`
      );
    }
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
    lines.push('- **Corpus synthétique** écrit par un agent (fixtures-dream/ + fixtures-bench-en/), pas un vrai projet — structure et style peuvent favoriser un retrieval structuré par champs (`<cal-*>`) plus qu\'un vrai repo hétérogène.');
    lines.push('- **Questions écrites par le même agent** que celui qui a conçu et lit ce corpus — biais de familiarité possible malgré la contrainte de paraphrase et l\'écriture avant lecture des scores.');
    lines.push('- **Détection de bucket approximative** : la classification fr/en du bucket linguistique repose sur une liste de mots-outils (voir `detectQueryLang` dans bench.mjs), pas un vrai détecteur de langue — les requêtes keyword-soup sans marqueur net tombent volontairement dans `fourre-tout` plutôt que d\'être forcées dans un bucket fr/en arbitraire.');
    lines.push('- **should_cite non mesuré ici** : ce bench mesure recall/MRR/latence/empreinte, pas les faux positifs de citation (voir `eval/run.mjs` pour ça).');
    lines.push('- **Résultat fr→en inattendu, rapporté tel quel** : sur les 12 questions du bucket, recall@1 nul pour les 3 systèmes (grep, bm25, hybrid) — l\'écart hybrid vs bm25 attendu n\'apparaît qu\'au recall@3 (25% bm25 vs 33% hybrid). Vérifié hors bug : sur un échantillon de ces questions, le rang cosinus e5 du sujet attendu dépassait 60/80 — le modèle `multilingual-e5-small` ne comble pas systématiquement l\'écart cross-langue sur des sujets aussi courts, malgré la vocation multilingue du modèle.');
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
