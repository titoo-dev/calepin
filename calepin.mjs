#!/usr/bin/env node
// Calepin — mémoire projet durable pour agents de code. CLI, zéro dépendance.
// Sortie JSON sur stdout pour query/current, messages humains sur stderr.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseTopic, renderPretty } from './lib/format.mjs';
import * as store from './lib/store.mjs';
import { getEmbedder, getEmbedderFailureReason, embedTopics } from './lib/embed.mjs';
import { loadHits, removeHit } from './lib/hits.mjs';
import { dream } from './lib/dream.mjs';
import * as sync from './lib/sync.mjs';
import { runQuery } from './lib/query.mjs';
import { clientRequest, startServer, stopServer } from './lib/serve.mjs';
import { gc } from './lib/cache.mjs';

const HELP = `calepin — mémoire projet durable pour agents de code

Usage:
  calepin bind <nom>                                lie cwd à l'espace perso <nom>
  calepin current                                   liste les espaces actifs (JSON)
  calepin record <categorie/slug> --title "T" --keywords "a,b" [--space equipe|perso] --html -
                                                      enregistre un sujet (enfants cal-* sur stdin)
  calepin remove <categorie/slug> [--space <label>] supprime un sujet (fichier + hits.json)
  calepin query "<question>" [--limit 5] [--space <label>] [--no-embed]
                                                      cherche dans les espaces actifs (JSON)
  calepin read <categorie/slug> [--space <label>] [--pretty]
                                                      dump d'un sujet (brut, ou lisible avec --pretty)
  calepin dream --mode merge|link|prune|synthesize [--min-score X] [--limit 10] [--space <label>] [--no-embed]
                                                      propose des consolidations (ne modifie rien)
  calepin sync [nom]                                 sync git des espaces perso (tous, ou <nom>)
  calepin serve                                      daemon local : embedder chaud, socket Unix
  calepin serve --stop                               arrête le daemon
  calepin cache gc [--max-age 90]                    purge les caches (vecteurs) + hits.json orphelins
  calepin onboard [--perso <nom>]                     crée .calepin/topics/, affiche le cycle query/record
  calepin --help                                     cette aide

Variables d'environnement:
  CALEPIN_HOME    racine de l'espace perso (défaut: ~/.calepin) — utile pour les tests.
`;

// Refus de secrets évidents au record. On affiche le NOM du motif, jamais la valeur.
const SECRET_PATTERNS = [
  { name: 'clé AWS (AKIA...)', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'clé API OpenAI-like (sk-...)', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'token GitHub (ghp_...)', re: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'clé privée PEM', re: /-----BEGIN .* PRIVATE KEY/ },
  { name: 'jeton Bearer', re: /Bearer [A-Za-z0-9._-]{20,}/ },
  { name: 'mot de passe en clair', re: /password\s*[:=]\s*\S+/i },
];

function fail(message) {
  process.stderr.write(`calepin: ${message}\n`);
  process.exit(1);
}

// ponytail: flags booléens (sans valeur qui suit) listés à la main — le
// parseur reste un simple découpage --clé valeur, pas un vrai parseur CLI.
const BOOLEAN_FLAGS = new Set(['no-embed', 'stop', 'pretty']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = argv[i + 1];
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function findSpace(spaces, label) {
  return spaces.find((s) => s.label === label) ?? null;
}

function cmdBind(positional) {
  const name = positional[0];
  if (!name) fail('bind: nom d\'espace requis (calepin bind <nom>)');
  store.bind(process.cwd(), name);
  process.stderr.write(`espace perso "${name}" lié à ${process.cwd()}\n`);
}

function cmdCurrent() {
  const spaces = store.activeSpaces(process.cwd());
  const out = {
    spaces: spaces.map((s) => ({
      label: s.label,
      root: s.root,
      topics: store.listTopics(s).length,
    })),
  };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

function cmdRecord(positional, flags) {
  const topicPath = positional[0];
  if (!topicPath) fail('record: chemin de sujet requis (calepin record <categorie/slug> ...)');
  try {
    store.validateTopicPath(topicPath);
  } catch (err) {
    fail(err.message);
  }
  if (!flags.title) fail('record: --title requis');
  if (flags.html !== '-') fail('record: --html - requis (les enfants cal-* sont lus sur stdin)');

  const stdinContent = readStdin().trim();
  const scanned = [stdinContent, flags.title, flags.keywords ?? ''].join('\n');
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(scanned)) {
      fail(`secret détecté (motif: ${name}) — record refusé`);
    }
  }

  // Enveloppe le corps stdin avec un cal-topic factice pour valider la
  // structure et extraire les enfants — les vrais attrs (title/keywords/…)
  // sont fournis séparément par les flags, pas par ce wrapper.
  let parsedBody;
  try {
    parsedBody = parseTopic(`<cal-topic dummy="1">\n${stdinContent}\n</cal-topic>`);
  } catch (err) {
    fail(`format invalide: ${err.message}`);
  }

  const spaces = store.activeSpaces(process.cwd());
  let target;
  if (flags.space === 'perso') {
    target = spaces.find((s) => s.label.startsWith('perso:'));
    if (!target) fail('record: --space perso demandé mais aucun espace perso bindé (calepin bind <nom>)');
  } else if (flags.space === 'equipe') {
    target = findSpace(spaces, 'equipe');
    if (!target) fail('record: --space equipe demandé mais pas de .calepin/ trouvé');
  } else {
    target = findSpace(spaces, 'equipe') ?? spaces.find((s) => s.label.startsWith('perso:'));
    if (!target) fail('record: aucun espace actif (ni équipe ni perso bindé — calepin bind <nom>)');
  }

  const existingRaw = store.readTopic(target, topicPath);
  const created = existingRaw ? parseTopic(existingRaw).created : todayISO();

  const obj = {
    title: flags.title,
    keywords: (flags.keywords ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0),
    created,
    updated: todayISO(),
    decisions: parsedBody.decisions,
    reasons: parsedBody.reasons,
    facts: parsedBody.facts,
    rules: parsedBody.rules,
    files: parsedBody.files,
    links: parsedBody.links,
    narration: parsedBody.narration,
  };

  const file = store.writeTopic(target, topicPath, obj);
  process.stderr.write(`sujet enregistré: ${target.label}/${topicPath} (${file})\n`);
}

// Symétrique de record : résolution d'espace comme read (premier match parmi
// les espaces actifs, ou --space précis), ferme la boucle dream (merge/prune
// proposent, l'agent applique record+remove).
function cmdRemove(positional, flags) {
  const topicPath = positional[0];
  if (!topicPath) fail('remove: chemin de sujet requis (calepin remove <categorie/slug>)');
  try {
    store.validateTopicPath(topicPath);
  } catch (err) {
    fail(err.message);
  }

  let spaces = store.activeSpaces(process.cwd());
  if (flags.space) {
    spaces = spaces.filter((s) => s.label === flags.space);
    if (spaces.length === 0) fail(`remove: espace "${flags.space}" introuvable`);
  }

  for (const space of spaces) {
    if (store.removeTopic(space, topicPath)) {
      removeHit(`${space.label}/${topicPath}`);
      process.stderr.write(`sujet supprimé: ${space.label}/${topicPath}\n`);
      return;
    }
  }
  fail(`remove: sujet "${topicPath}" introuvable dans les espaces actifs`);
}

async function cmdQuery(positional, flags) {
  const question = positional[0];
  if (!question) fail('query: question requise (calepin query "<question>")');
  const limit = flags.limit ? parseInt(flags.limit, 10) : 5;
  const noEmbed = Boolean(flags['no-embed']);
  if (noEmbed) process.env.CALEPIN_NO_EMBED = '1'; // fallback in-process : désactive l'embedder pour tout le process
  const space = flags.space ?? null;

  // Daemon d'abord (embedder chaud, voir calepin serve) : connexion + timeout
  // courts, JAMAIS d'erreur à cause du daemon — absent/mort/lent -> in-process.
  const req = { op: 'query', cwd: process.cwd(), question, limit, space, noEmbed };
  const served = await clientRequest(req);
  if (served && !served.error) {
    process.stdout.write(JSON.stringify({ ...served, served: true }, null, 2) + '\n');
    return;
  }

  const out = await runQuery({ cwd: process.cwd(), question, limit, space, noEmbed });
  process.stdout.write(JSON.stringify({ ...out, served: false }, null, 2) + '\n');
}

function cmdRead(positional, flags) {
  const topicPath = positional[0];
  if (!topicPath) fail('read: chemin de sujet requis (calepin read <categorie/slug>)');

  let spaces = store.activeSpaces(process.cwd());
  if (flags.space) {
    spaces = spaces.filter((s) => s.label === flags.space);
    if (spaces.length === 0) fail(`read: espace "${flags.space}" introuvable`);
  }

  for (const space of spaces) {
    const raw = store.readTopic(space, topicPath);
    if (raw != null) {
      process.stdout.write(flags.pretty ? renderPretty(parseTopic(raw)) : raw);
      return;
    }
  }
  fail(`read: sujet "${topicPath}" introuvable dans les espaces actifs`);
}

const DREAM_MODES = ['merge', 'link', 'prune', 'synthesize'];

async function cmdDream(_positional, flags) {
  if (!DREAM_MODES.includes(flags.mode)) {
    fail(`dream: --mode requis parmi ${DREAM_MODES.join('|')}`);
  }
  const limit = flags.limit ? parseInt(flags.limit, 10) : 10;
  const minScore = flags['min-score'] !== undefined ? parseFloat(flags['min-score']) : undefined;
  if (flags['no-embed']) process.env.CALEPIN_NO_EMBED = '1';

  let spaces = store.activeSpaces(process.cwd());
  if (flags.space) {
    spaces = spaces.filter((s) => s.label === flags.space);
  }

  const topics = [];
  for (const space of spaces) {
    for (const entry of store.listTopics(space)) {
      const raw = store.readTopic(space, entry.path);
      if (raw == null) continue;
      topics.push({ space: entry.space, path: entry.path, obj: parseTopic(raw), raw });
    }
  }

  let topicVectors = null;
  const embedder = await getEmbedder();
  if (embedder) {
    try {
      topicVectors = await embedTopics(topics, embedder);
    } catch (err) {
      process.stderr.write(`calepin: embeddings indisponibles (${err.message}), fallback jaccard\n`);
    }
  } else {
    process.stderr.write(
      `calepin: embeddings indisponibles (${getEmbedderFailureReason() ?? 'raison inconnue'}), fallback jaccard\n`
    );
  }

  const result = dream(topics, { mode: flags.mode, minScore, limit, topicVectors, hits: loadHits() });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

function cmdSync(positional) {
  const names = positional[0] ? [positional[0]] : sync.listPersonalSpaceNames();
  if (names.length === 0) {
    process.stderr.write('calepin: sync: aucun espace perso à synchroniser\n');
    return;
  }
  let failed = false;
  for (const name of names) {
    const result = sync.syncSpace(name);
    process.stderr.write(`${result.message}\n`);
    if (!result.ok) failed = true;
  }
  if (failed) process.exit(1);
}

async function cmdServe(flags) {
  if (flags.stop) {
    const result = stopServer();
    process.stderr.write(`${result.message}\n`);
    if (!result.ok) process.exit(1);
    return;
  }
  try {
    await startServer();
  } catch (err) {
    fail(err.message);
  }
}

function cmdCache(positional, flags) {
  const sub = positional[0];
  if (sub !== 'gc') fail(`cache: sous-commande inconnue "${sub ?? ''}" (calepin cache gc)`);
  const maxAgeDays = flags['max-age'] ? parseFloat(flags['max-age']) : 90;
  const result = gc(maxAgeDays, process.cwd());
  process.stderr.write(
    `cache gc: ${result.filesRemoved} fichier(s) de cache supprimé(s) (${result.bytesFreed} octets), ` +
      `${result.hitsRemoved} entrée(s) hits.json orpheline(s)\n`
  );
}

function cmdOnboard(flags) {
  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
  const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : process.cwd();
  const topicsDir = path.join(root, '.calepin', 'topics');
  const alreadyThere = fs.existsSync(topicsDir);
  fs.mkdirSync(topicsDir, { recursive: true });

  if (flags.perso) {
    store.bind(process.cwd(), flags.perso);
  }

  const spaces = store.activeSpaces(process.cwd());
  process.stderr.write(
    `${alreadyThere ? 'espace équipe déjà présent' : 'espace équipe créé'}: ${topicsDir}\n` +
      `espaces actifs: ${spaces.map((s) => s.label).join(', ') || 'aucun'}\n\n` +
      'Cycle : query AVANT une tâche non triviale (les hits sont des contraintes), record APRÈS un travail utile.\n\n' +
      '  calepin query "termes de la tâche" --limit 5\n' +
      '  calepin record architecture/exemple --title "Titre" --keywords "a,b" --html - <<\'EOF\'\n' +
      '  <cal-decision>Décision prise.</cal-decision>\n' +
      '  EOF\n' +
      '  calepin current\n'
  );
}

async function main() {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  const { positional, flags } = parseArgs(rest);

  switch (command) {
    case 'bind':
      return cmdBind(positional);
    case 'current':
      return cmdCurrent();
    case 'record':
      return cmdRecord(positional, flags);
    case 'remove':
      return cmdRemove(positional, flags);
    case 'query':
      return await cmdQuery(positional, flags);
    case 'read':
      return cmdRead(positional, flags);
    case 'dream':
      return await cmdDream(positional, flags);
    case 'sync':
      return cmdSync(positional);
    case 'serve':
      return await cmdServe(flags);
    case 'cache':
      return cmdCache(positional, flags);
    case 'onboard':
      return cmdOnboard(flags);
    default:
      fail(`commande inconnue: "${command}" (calepin --help)`);
  }
}

main().catch((err) => {
  process.stderr.write(`calepin: erreur inattendue: ${err.message}\n`);
  process.exit(1);
});
