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

test('query incrémente hits.json pour chaque hit retourné', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'hits-space'], { cwd: projectDir, home });
  runCli(
    ['record', 'auth/daemon', '--title', 'Auth daemon', '--keywords', 'auth,daemon', '--html', '-'],
    { cwd: projectDir, home, input: '<cal-fact>Le daemon tourne en user-space.</cal-fact>\n' }
  );

  const hitsFile = path.join(home, 'cache', 'hits.json');
  assert.ok(!fs.existsSync(hitsFile), 'pas de hits.json avant la première query');

  const res1 = runCli(['query', 'daemon auth'], { cwd: projectDir, home });
  assert.equal(res1.status, 0, res1.stderr);
  const out1 = JSON.parse(res1.stdout);
  assert.ok(out1.hits.length > 0);

  const data1 = JSON.parse(fs.readFileSync(hitsFile, 'utf8'));
  const key = `${out1.hits[0].space}/${out1.hits[0].path}`;
  assert.equal(data1[key].count, 1);
  assert.match(data1[key].last, /^\d{4}-\d{2}-\d{2}$/);

  runCli(['query', 'daemon auth'], { cwd: projectDir, home });
  const data2 = JSON.parse(fs.readFileSync(hitsFile, 'utf8'));
  assert.equal(data2[key].count, 2);
});

test('loadHits: fichier corrompu -> objet vide, jamais bloquant', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const prevHome = process.env.CALEPIN_HOME;
  process.env.CALEPIN_HOME = home;
  try {
    const { loadHits, recordHits } = await import('../lib/hits.mjs');
    fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(home, 'cache', 'hits.json'), '{ not json at all');

    assert.deepEqual(loadHits(), {});
    assert.doesNotThrow(() => recordHits([{ space: 'equipe', path: 'a/b' }]));
  } finally {
    if (prevHome === undefined) delete process.env.CALEPIN_HOME;
    else process.env.CALEPIN_HOME = prevHome;
  }
});

test('recordHits: échec d\'écriture (home invalide) reste silencieux', async () => {
  const prevHome = process.env.CALEPIN_HOME;
  // Chemin impossible à créer (fichier existant utilisé comme dossier parent).
  const blocker = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-blocker-'));
  const blockerFile = path.join(blocker, 'im-a-file');
  fs.writeFileSync(blockerFile, 'x');
  process.env.CALEPIN_HOME = path.join(blockerFile, 'not-writable');
  try {
    const { recordHits } = await import('../lib/hits.mjs');
    assert.doesNotThrow(() => recordHits([{ space: 'equipe', path: 'a/b' }]));
  } finally {
    if (prevHome === undefined) delete process.env.CALEPIN_HOME;
    else process.env.CALEPIN_HOME = prevHome;
  }
});
