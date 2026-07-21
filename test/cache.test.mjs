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

function writeAged(file, content, ageDays) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const past = new Date(Date.now() - ageDays * 86400000);
  fs.utimesSync(file, past, past);
}

test('gc: purge les fichiers de cache plus vieux que --max-age, garde les récents', async () => {
  await withTmpHome(async (home) => {
    const { gc } = await import('../lib/cache.mjs');

    const old = path.join(home, 'cache', 'embeddings', 'vieux.json');
    const recent = path.join(home, 'cache', 'queries', 'recent.json');
    writeAged(old, JSON.stringify({ model: 'm', vector: [1] }), 120);
    writeAged(recent, JSON.stringify({ model: 'm', vector: [1] }), 1);

    const result = gc(90, home);
    assert.equal(result.filesRemoved, 1);
    assert.ok(result.bytesFreed > 0);
    assert.ok(!fs.existsSync(old));
    assert.ok(fs.existsSync(recent));
  });
});

test('gc: purge les entrées hits.json dont le sujet n\'existe plus', async () => {
  await withTmpHome(async (home) => {
    const store = await import('../lib/store.mjs');
    const { gc } = await import('../lib/cache.mjs');

    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
    store.bind(projectDir, 'gc-space');
    const space = store.activeSpaces(projectDir)[0];
    store.writeTopic(space, 'notes/vivant', {
      title: 'Vivant',
      keywords: [],
      created: '2026-01-01',
      updated: '2026-01-01',
      decisions: [],
      reasons: [],
      facts: ['x'],
      rules: [],
      files: [],
      links: [],
      narration: '',
    });

    const hitsFile = path.join(home, 'cache', 'hits.json');
    fs.mkdirSync(path.dirname(hitsFile), { recursive: true });
    fs.writeFileSync(
      hitsFile,
      JSON.stringify({
        'perso:gc-space/notes/vivant': { count: 3, last: '2026-07-01' },
        'perso:gc-space/notes/disparu': { count: 1, last: '2026-01-01' },
      })
    );

    const result = gc(90, projectDir);
    assert.equal(result.hitsRemoved, 1);
    const hitsAfter = JSON.parse(fs.readFileSync(hitsFile, 'utf8'));
    assert.ok('perso:gc-space/notes/vivant' in hitsAfter);
    assert.ok(!('perso:gc-space/notes/disparu' in hitsAfter));
  });
});

test('gc: dossiers de cache absents -> pas d\'erreur, bilan vide', async () => {
  await withTmpHome(async (home) => {
    const { gc } = await import('../lib/cache.mjs');
    const result = gc(90, home);
    assert.deepEqual(result, { filesRemoved: 0, bytesFreed: 0, hitsRemoved: 0 });
  });
});
