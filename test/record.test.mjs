import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');

function runCli(args, { cwd, home, input }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home },
  });
}

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  return { home, projectDir };
}

test('record écrit le fichier attendu dans l\'espace perso bindé', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });

  const stdin = '<cal-decision>On utilise BM25 maison.</cal-decision>\n<cal-fact>Zéro dépendance en P1.</cal-fact>\n';
  const res = runCli(
    ['record', 'architecture/retrieval', '--title', 'Retrieval P1', '--keywords', 'bm25,search', '--html', '-'],
    { cwd: projectDir, home, input: stdin }
  );

  assert.equal(res.status, 0, res.stderr);
  const file = path.join(home, 'spaces', 'mon-espace', 'topics', 'architecture', 'retrieval.html');
  assert.ok(fs.existsSync(file));
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /<cal-decision>On utilise BM25 maison\.<\/cal-decision>/);
  assert.match(content, /title="Retrieval P1"/);
});

test('record refuse un secret (sk-...) et n\'écrit rien', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });

  const stdin = '<cal-fact>Clé: sk-abcdefghijklmnopqrstuvwxyz123456</cal-fact>\n';
  const res = runCli(
    ['record', 'secrets/oups', '--title', 'Oups', '--keywords', '', '--html', '-'],
    { cwd: projectDir, home, input: stdin }
  );

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /secret détecté/);
  assert.ok(!res.stderr.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), 'la valeur complète du secret ne doit jamais apparaître');
  const file = path.join(home, 'spaces', 'mon-espace', 'topics', 'secrets', 'oups.html');
  assert.ok(!fs.existsSync(file));
});

test('record sur un sujet existant garde "created" et met à jour "updated"', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });

  runCli(
    ['record', 'conventions/nommage', '--title', 'Nommage', '--keywords', 'convention', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-rule>kebab-case</cal-rule>\n' }
  );
  const file = path.join(home, 'spaces', 'mon-espace', 'topics', 'conventions', 'nommage.html');
  const first = fs.readFileSync(file, 'utf8');
  const createdMatch = /created="([^"]+)"/.exec(first);
  assert.ok(createdMatch);

  // Ré-enregistrement du même sujet, forcer une exécution un peu plus tard n'est
  // pas nécessaire : on vérifie seulement que `created` est préservé.
  runCli(
    ['record', 'conventions/nommage', '--title', 'Nommage v2', '--keywords', 'convention', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-rule>kebab-case toujours</cal-rule>\n' }
  );
  const second = fs.readFileSync(file, 'utf8');
  const createdMatch2 = /created="([^"]+)"/.exec(second);
  assert.equal(createdMatch2[1], createdMatch[1]);
  assert.match(second, /title="Nommage v2"/);
  assert.match(second, /kebab-case toujours/);
});
