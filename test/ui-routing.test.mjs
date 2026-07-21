// Routage TUI (voir docs/adr/0004) : `calepin ui` et `calepin onboard` sans
// TTY. Le rendu ink/@clack lui-même n'est pas testé ici (pas de harnais TTY,
// voir scripts/smoke-ui.mjs et lib/ui-logic.mjs pour la logique pure) — juste
// le contrat de routage : jamais de crash, jamais de blocage, exit 0.
// Tourne aussi bien sans dist/ que build (npm test ne dépend jamais de dist/,
// voir PRD/ADR) : les scénarios "sans dist" déplacent temporairement
// dist/ui.js s'il existe, pour tester le repli quel que soit l'état du build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');
const DIST = path.join(import.meta.dirname, '..', 'dist', 'ui.js');
const DIST_BACKUP = path.join(import.meta.dirname, '..', 'dist', 'ui.js.test-bak');

function runCli(args, { cwd, home }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1' },
  });
}

function tmp() {
  return {
    home: fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-')),
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-')),
  };
}

function withoutDist(fn) {
  const hadDist = fs.existsSync(DIST);
  if (hadDist) fs.renameSync(DIST, DIST_BACKUP);
  try {
    return fn();
  } finally {
    if (hadDist) fs.renameSync(DIST_BACKUP, DIST);
  }
}

test('ui: sans dist/ui.js -> message une ligne + exit 0 (pas de crash)', () => {
  withoutDist(() => {
    const { home, cwd } = tmp();
    const res = runCli(['ui'], { cwd, home });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /TUI non construite/);
    assert.match(res.stderr, /npm run build/);
  });
});

test('onboard: sans dist/ui.js, non-TTY -> comportement standard inchangé', () => {
  withoutDist(() => {
    const { home, cwd } = tmp();
    const res = runCli(['onboard'], { cwd, home });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /espace équipe créé/);
    assert.match(res.stderr, /Cycle :/);
  });
});

test('query non-TTY : sortie JSON valide, routage TUI n\'interfère pas avec le cœur', () => {
  const { home, cwd } = tmp();
  runCli(['bind', 'routing-space'], { cwd, home });
  spawnSync(process.execPath, [CLI, 'record', 'notes/cafe', '--title', 'Café', '--keywords', 'café', '--html', '-'], {
    cwd,
    input: "<p>test</p>\n",
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1' },
  });
  const res = runCli(['query', 'café'], { cwd, home });
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotThrow(() => JSON.parse(res.stdout));
});

if (fs.existsSync(DIST)) {
  test('ui: avec dist/ui.js, stdin non-TTY -> ne plante pas, ne bloque pas, exit 0', () => {
    const { home, cwd } = tmp();
    const res = runCli(['ui'], { cwd, home });
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stderr, /at file:\/\//);
  });

  test('onboard: avec dist/ui.js, non-TTY -> route quand même vers le comportement standard', () => {
    const { home, cwd } = tmp();
    const res = runCli(['onboard'], { cwd, home });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /espace équipe créé/);
  });
} else {
  test('ui/onboard avec dist : sauté (dist/ui.js absent — `npm run build` d\'abord)', () => {});
}
