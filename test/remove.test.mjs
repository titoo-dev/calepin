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
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1' },
  });
}

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  return { home, projectDir };
}

test('remove supprime le fichier et l\'entrée hits.json', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/jetable', '--title', 'Jetable', '--keywords', 'jetable', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-fact>Fait jetable.</cal-fact>\n' }
  );
  runCli(['query', 'jetable'], { cwd: projectDir, home });

  const file = path.join(home, 'spaces', 'mon-espace', 'topics', 'notes', 'jetable.html');
  assert.ok(fs.existsSync(file));
  const hitsFile = path.join(home, 'cache', 'hits.json');
  const hitsBefore = JSON.parse(fs.readFileSync(hitsFile, 'utf8'));
  assert.ok('perso:mon-espace/notes/jetable' in hitsBefore);

  const res = runCli(['remove', 'notes/jetable'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!fs.existsSync(file));

  const hitsAfter = JSON.parse(fs.readFileSync(hitsFile, 'utf8'));
  assert.ok(!('perso:mon-espace/notes/jetable' in hitsAfter));
});

test('remove supprime les dossiers devenus vides sous topics/', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });
  runCli(
    ['record', 'a/b/c/sujet', '--title', 'Profond', '--keywords', 'profond', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-fact>x</cal-fact>\n' }
  );

  const topicsDir = path.join(home, 'spaces', 'mon-espace', 'topics');
  assert.ok(fs.existsSync(path.join(topicsDir, 'a', 'b', 'c')));

  const res = runCli(['remove', 'a/b/c/sujet'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!fs.existsSync(path.join(topicsDir, 'a')), 'les dossiers vides a/b/c doivent être supprimés');
  assert.ok(fs.existsSync(topicsDir), 'topics/ lui-même reste');
});

test('remove: sujet introuvable -> exit 1', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });
  const res = runCli(['remove', 'notes/inconnu'], { cwd: projectDir, home });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /introuvable/);
});

test('remove: --space cible un espace précis', () => {
  const { home, projectDir } = setup();
  runCli(['bind', 'mon-espace'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/jetable', '--title', 'Jetable', '--keywords', 'jetable', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-fact>x</cal-fact>\n' }
  );

  const resWrongSpace = runCli(['remove', 'notes/jetable', '--space', 'equipe'], { cwd: projectDir, home });
  assert.notEqual(resWrongSpace.status, 0);

  const res = runCli(['remove', 'notes/jetable', '--space', 'perso:mon-espace'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
});
