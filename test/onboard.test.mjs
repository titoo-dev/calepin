import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');

function runCli(args, { cwd, home }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1' },
  });
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} a échoué: ${res.stderr}`);
  return res;
}

test('onboard: crée .calepin/topics/ à la racine du repo git, pas dans un sous-dossier', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-repo-'));
  git(['init', '--initial-branch=main'], repo);
  const nested = path.join(repo, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });

  const res = runCli(['onboard'], { cwd: nested, home });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(repo, '.calepin', 'topics')));
  assert.ok(!fs.existsSync(path.join(nested, '.calepin')));
  assert.match(res.stderr, /espace équipe créé/);
});

test('onboard: idempotent, ré-exécuter ne plante pas et le signale', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));

  const first = runCli(['onboard'], { cwd: projectDir, home });
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.existsSync(path.join(projectDir, '.calepin', 'topics')));

  const second = runCli(['onboard'], { cwd: projectDir, home });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /déjà présent/);
});

test('onboard --perso <nom> : bind en plus de créer .calepin/topics/', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));

  const res = runCli(['onboard', '--perso', 'mon-perso'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(fs.existsSync(path.join(projectDir, '.calepin', 'topics')));

  const current = JSON.parse(runCli(['current'], { cwd: projectDir, home }).stdout);
  assert.ok(current.spaces.some((s) => s.label === 'perso:mon-perso'));
  assert.ok(current.spaces.some((s) => s.label === 'equipe'));
});
