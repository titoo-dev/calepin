import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function withTmpHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const prevHome = process.env.CALEPIN_HOME;
  process.env.CALEPIN_HOME = home;
  try {
    return await fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.CALEPIN_HOME;
    else process.env.CALEPIN_HOME = prevHome;
  }
}

test('findTeamRoot: découvre .calepin/ en remontant les dossiers parents', async () => {
  const { findTeamRoot } = await import('../lib/store.mjs');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-repo-'));
  fs.mkdirSync(path.join(repo, '.calepin'));
  const nested = path.join(repo, 'src', 'deep', 'nested');
  fs.mkdirSync(nested, { recursive: true });

  assert.equal(findTeamRoot(nested), repo);
  assert.equal(findTeamRoot(os.tmpdir()), null);
});

test('bind + résolution : le préfixe le plus long correspondant à cwd gagne', async () => {
  await withTmpHome(async () => {
    const store = await import('../lib/store.mjs');
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-outer-'));
    const inner = path.join(outer, 'projet-a');
    fs.mkdirSync(inner, { recursive: true });

    store.bind(outer, 'espace-large');
    store.bind(inner, 'espace-precis');

    const spacesOuter = store.activeSpaces(outer);
    const spacesInner = store.activeSpaces(inner);

    assert.equal(spacesOuter.find((s) => s.label.startsWith('perso:')).label, 'perso:espace-large');
    assert.equal(spacesInner.find((s) => s.label.startsWith('perso:')).label, 'perso:espace-precis');
  });
});

test('validateTopicPath refuse chemin invalide et ..', async () => {
  const { validateTopicPath } = await import('../lib/store.mjs');
  assert.throws(() => validateTopicPath('../etc/passwd'));
  assert.throws(() => validateTopicPath('Categorie/Slug'));
  assert.throws(() => validateTopicPath('a//b'));
  assert.doesNotThrow(() => validateTopicPath('architecture/overview'));
  assert.doesNotThrow(() => validateTopicPath('conventions/nommage-fichiers'));
});

test('writeTopic puis readTopic round-trip sur disque', async () => {
  await withTmpHome(async () => {
    const store = await import('../lib/store.mjs');
    const { parseTopic } = await import('../lib/format.mjs');
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
    store.bind(projectDir, 'test-space');
    const space = store.activeSpaces(projectDir)[0];

    const obj = {
      title: 'T',
      keywords: ['a', 'b'],
      created: '2026-01-01',
      updated: '2026-01-01',
      decisions: ['D'],
      reasons: [],
      facts: [],
      rules: [],
      files: [],
      links: [],
      narration: '',
    };
    store.writeTopic(space, 'conventions/exemple', obj);
    const raw = store.readTopic(space, 'conventions/exemple');
    assert.deepEqual(parseTopic(raw), obj);
    assert.equal(store.listTopics(space).length, 1);
  });
});
