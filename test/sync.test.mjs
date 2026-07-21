import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');

function runCli(args, { cwd, home, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1', ...env },
  });
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} a échoué: ${res.stderr}`);
  return res;
}

function newHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
}

test('sync: espace perso non-git -> exit 1 + message avec marche à suivre', () => {
  const home = newHome();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'non-git-space'], { cwd: projectDir, home });

  const res = runCli(['sync', 'non-git-space'], { cwd: projectDir, home });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /pas un dépôt git/);
  assert.match(res.stderr, /git init/);
  assert.match(res.stderr, /git remote add/);
});

test('sync: espace inconnu -> exit 1', () => {
  const home = newHome();
  const res = runCli(['sync', 'inconnu'], { cwd: home, home });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /introuvable/);
});

test('sync: sans argument -> aucun espace perso -> pas d\'erreur, message informatif', () => {
  const home = newHome();
  const res = runCli(['sync'], { cwd: home, home });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /aucun espace perso/);
});

test('sync: commit + push vers un remote bare local, rien à committer au 2e sync', () => {
  const home = newHome();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'synced-space'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/exemple', '--title', 'Exemple', '--keywords', 'exemple', '--html', '-'],
    { cwd: projectDir, home, env: {} }
  );

  const spaceDir = path.join(home, 'spaces', 'synced-space');
  const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-bare-'));
  git(['init', '--bare', '--initial-branch=main', bareDir], undefined);
  git(['init', '--initial-branch=main'], spaceDir);
  git(['config', 'user.email', 'test@example.com'], spaceDir);
  git(['config', 'user.name', 'Test'], spaceDir);
  git(['remote', 'add', 'origin', bareDir], spaceDir);

  const res1 = runCli(['sync', 'synced-space'], { cwd: projectDir, home });
  assert.equal(res1.status, 0, res1.stderr);
  assert.match(res1.stderr, /synchronisé/);

  const log = spawnSync('git', ['log', '--oneline'], { cwd: spaceDir, encoding: 'utf8' });
  assert.match(log.stdout, /calepin sync/);

  // Rien de nouveau à committer : le 2e sync ne doit pas créer de commit vide.
  const countBefore = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: spaceDir, encoding: 'utf8' }).stdout.trim();
  const res2 = runCli(['sync', 'synced-space'], { cwd: projectDir, home });
  assert.equal(res2.status, 0, res2.stderr);
  const countAfter = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: spaceDir, encoding: 'utf8' }).stdout.trim();
  assert.equal(countAfter, countBefore, 'pas de commit vide au 2e sync');

  // Le remote bare a bien reçu le push.
  const bareLog = spawnSync('git', ['log', '--oneline', 'main'], { cwd: bareDir, encoding: 'utf8' });
  assert.match(bareLog.stdout, /calepin sync/);
});

test('sync: pas de remote configuré -> commit local seul, pas d\'erreur', () => {
  const home = newHome();
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'local-only-space'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/exemple', '--title', 'Exemple', '--keywords', 'exemple', '--html', '-'],
    { cwd: projectDir, home }
  );

  const spaceDir = path.join(home, 'spaces', 'local-only-space');
  git(['init', '--initial-branch=main'], spaceDir);
  git(['config', 'user.email', 'test@example.com'], spaceDir);
  git(['config', 'user.name', 'Test'], spaceDir);

  const res = runCli(['sync', 'local-only-space'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /commit local seul/);
});
