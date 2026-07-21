#!/usr/bin/env node
// Smoke test de la TUI (voir docs/adr/0004) : pas de harnais ink complet ici,
// juste "ça ne plante pas" sans pseudo-TTY (stdin /dev/null, dist présent ou
// absent). Complète test/ui-routing.test.mjs (mêmes scénarios via node --test).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'calepin.mjs');
const DIST = path.join(ROOT, 'dist', 'ui.js');
const DIST_BACKUP = path.join(ROOT, 'dist', 'ui.js.smoke-bak');

function run(args, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: home.project,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    env: { ...process.env, CALEPIN_HOME: home.calepin, CALEPIN_NO_EMBED: '1' },
  });
}

function fail(msg) {
  console.error(`smoke-ui: ÉCHEC — ${msg}`);
  process.exitCode = 1;
}

function tmpHome() {
  return {
    calepin: fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-smoke-home-')),
    project: fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-smoke-proj-')),
  };
}

const hadDist = fs.existsSync(DIST);
if (hadDist) fs.renameSync(DIST, DIST_BACKUP);

try {
  // 1. dist/ui.js absent : `calepin ui` -> message une ligne, exit 0, pas de crash.
  {
    const res = run(['ui'], tmpHome());
    if (res.status !== 0) fail(`ui sans dist: exit ${res.status} (attendu 0)\n${res.stderr}`);
    if (!/TUI non construite/.test(res.stderr)) fail(`ui sans dist: message attendu absent\n${res.stderr}`);
    console.log('ok: calepin ui sans dist -> message + exit 0');
  }

  // 2. dist/ui.js absent : `calepin onboard` non-TTY -> comportement standard inchangé.
  {
    const res = run(['onboard'], tmpHome());
    if (res.status !== 0) fail(`onboard sans dist: exit ${res.status} (attendu 0)\n${res.stderr}`);
    if (!/espace équipe créé/.test(res.stderr)) fail(`onboard sans dist: sortie standard absente\n${res.stderr}`);
    console.log('ok: calepin onboard sans dist -> comportement standard, exit 0');
  }
} finally {
  if (hadDist) fs.renameSync(DIST_BACKUP, DIST);
}

if (fs.existsSync(DIST)) {
  // 3. dist/ui.js présent, stdin non-TTY (/dev/null) : ne doit jamais planter
  // ni bloquer (clack/ink détectent l'absence de TTY et se terminent).
  {
    const res = run(['ui'], tmpHome());
    if (res.status !== 0) fail(`ui avec dist, non-TTY: exit ${res.status} (attendu 0)\n${res.stderr}`);
    if (/Error|TypeError|at file:/.test(res.stderr)) fail(`ui avec dist, non-TTY: trace d'erreur inattendue\n${res.stderr}`);
    console.log('ok: calepin ui avec dist, non-TTY -> pas de crash, exit 0');
  }

  // 4. dist/ui.js présent, `calepin onboard` non-TTY -> route quand même vers
  // le comportement standard (TUI réservée au TTY interactif).
  {
    const res = run(['onboard'], tmpHome());
    if (res.status !== 0) fail(`onboard avec dist, non-TTY: exit ${res.status} (attendu 0)\n${res.stderr}`);
    if (!/espace équipe créé/.test(res.stderr)) fail(`onboard avec dist, non-TTY: sortie standard absente\n${res.stderr}`);
    console.log('ok: calepin onboard avec dist, non-TTY -> comportement standard, exit 0');
  }
} else {
  console.log('(dist/ui.js absent — étapes 3/4 sautées ; lance `npm run build` pour les couvrir)');
}

if (process.exitCode) {
  console.error('smoke-ui: des vérifications ont échoué (voir ci-dessus)');
} else {
  console.log('smoke-ui: tout est vert');
}
