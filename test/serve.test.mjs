import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');

function runCli(args, { cwd, home, input, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1', ...env },
  });
}

// Attend qu'une condition devienne vraie, sans dormir plus que nécessaire.
async function waitFor(predicate, { timeoutMs = 5000, stepMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

function spawnServe(home, cwd) {
  return spawn(process.execPath, [CLI, 'serve'], {
    cwd,
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1' },
  });
}

test('serve: e2e — query cliente passe par le socket (served:true), --stop l\'arrête', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'serve-space'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/daemon', '--title', 'Daemon de test', '--keywords', 'daemon,test', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-fact>Le daemon répond via socket.</cal-fact>\n' }
  );

  const socketPath = path.join(home, 'serve.sock');
  const pidPath = path.join(home, 'serve.pid');

  const daemon = spawnServe(home, projectDir);
  let daemonErr = '';
  daemon.stderr.on('data', (c) => (daemonErr += c));

  try {
    const up = await waitFor(() => fs.existsSync(socketPath) && fs.existsSync(pidPath));
    assert.ok(up, `le daemon n'a jamais créé son socket/pidfile: ${daemonErr}`);

    const res = runCli(['query', 'daemon de test'], { cwd: projectDir, home });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.served, true, 'la query doit passer par le daemon');
    assert.equal(out.hits[0].path, 'notes/daemon');
    assert.equal(out.mode, 'bm25'); // CALEPIN_NO_EMBED côté daemon aussi

    // deuxième `serve` pendant que le premier tourne : idempotent, exit 0, ne
    // touche ni socket ni pidfile, le premier daemon continue de répondre.
    const second = runCli(['serve'], { cwd: projectDir, home });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stderr, /déjà actif/);

    const stillUp = runCli(['query', 'daemon de test'], { cwd: projectDir, home });
    assert.equal(JSON.parse(stillUp.stdout).served, true, 'le premier daemon doit toujours répondre');

    const stopRes = runCli(['serve', '--stop'], { cwd: projectDir, home });
    assert.equal(stopRes.status, 0, stopRes.stderr);

    const down = await waitFor(() => !fs.existsSync(socketPath) && !fs.existsSync(pidPath));
    assert.ok(down, 'socket/pidfile doivent disparaître après --stop');

    const afterStop = runCli(['query', 'daemon de test'], { cwd: projectDir, home });
    assert.equal(afterStop.status, 0, afterStop.stderr);
    assert.equal(JSON.parse(afterStop.stdout).served, false, 'daemon éteint -> fallback in-process');
  } finally {
    if (!daemon.killed) daemon.kill('SIGTERM');
  }
});

test('serve --stop: pidfile absent -> exit 1, message clair', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const res = runCli(['serve', '--stop'], { cwd: home, home });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /aucun daemon actif/);
});

test('serve: socket périmé (fichier présent, personne à l\'écoute) est écrasé au démarrage', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  fs.writeFileSync(path.join(home, 'serve.sock'), ''); // fichier périmé, rien n'écoute dessus

  const socketPath = path.join(home, 'serve.sock');
  const daemon = spawnServe(home, projectDir);
  try {
    const up = await waitFor(async () => {
      if (!fs.existsSync(socketPath)) return false;
      const res = runCli(['query', 'x'], { cwd: projectDir, home });
      return res.status === 0;
    });
    assert.ok(up, 'le daemon doit démarrer malgré le socket périmé');
  } finally {
    daemon.kill('SIGTERM');
  }
});
