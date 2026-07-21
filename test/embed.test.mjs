import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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

// Embedder-espion : jamais le vrai modèle, offline. Compte les appels et
// retourne des vecteurs déterministes basés sur l'index du texte.
function spyEmbedder(dim = 3) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async embed(texts) {
      calls += texts.length;
      return texts.map((_, i) => Float32Array.from({ length: dim }, (_, j) => (i + 1) * 0.1 + j));
    },
  };
}

test('embedTopics: 2e appel avec un embedder-espion n\'embed rien (cache par hash)', async () => {
  await withTmpHome(async () => {
    const { embedTopics } = await import('../lib/embed.mjs');
    const entries = [
      { space: 'equipe', path: 'a', obj: { title: 'A' }, raw: '<cal-topic>A</cal-topic>' },
      { space: 'equipe', path: 'b', obj: { title: 'B' }, raw: '<cal-topic>B</cal-topic>' },
    ];

    const embedder1 = spyEmbedder();
    const vectors1 = await embedTopics(entries, embedder1);
    assert.equal(embedder1.calls, 2);
    assert.equal(vectors1.size, 2);

    const embedder2 = spyEmbedder();
    const vectors2 = await embedTopics(entries, embedder2);
    assert.equal(embedder2.calls, 0, 'tout est en cache, aucun embed() ne devrait être appelé');
    assert.deepEqual(Array.from(vectors2.get('equipe/a')), Array.from(vectors1.get('equipe/a')));
  });
});

test('embedTopics: contenu modifié (hash différent) -> ré-embed', async () => {
  await withTmpHome(async () => {
    const { embedTopics } = await import('../lib/embed.mjs');
    const embedder = spyEmbedder();
    await embedTopics([{ space: 's', path: 'x', obj: { title: 'X' }, raw: 'contenu v1' }], embedder);
    assert.equal(embedder.calls, 1);
    await embedTopics([{ space: 's', path: 'x', obj: { title: 'X2' }, raw: 'contenu v2' }], embedder);
    assert.equal(embedder.calls, 2);
  });
});

test('embedTopics: cache invalidé si le modèle enregistré diffère du modèle courant', async () => {
  await withTmpHome(async (home) => {
    const { embedTopics } = await import('../lib/embed.mjs');
    const embedder = spyEmbedder();
    const entries = [{ space: 's', path: 'x', obj: { title: 'X' }, raw: 'contenu-stable' }];
    await embedTopics(entries, embedder);
    assert.equal(embedder.calls, 1);

    const hash = crypto.createHash('sha256').update('contenu-stable').digest('hex');
    const file = path.join(home, 'cache', 'embeddings', `${hash}.json`);
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    cached.model = 'un-autre-modele';
    fs.writeFileSync(file, JSON.stringify(cached));

    await embedTopics(entries, embedder);
    assert.equal(embedder.calls, 2, 'modèle différent -> le cache doit être ignoré');
  });
});

test('embedTopics: sans embedder (null), retourne une Map vide sans planter', async () => {
  await withTmpHome(async () => {
    const { embedTopics } = await import('../lib/embed.mjs');
    const result = await embedTopics([{ space: 's', path: 'x', obj: { title: 'X' }, raw: 'r' }], null);
    assert.equal(result.size, 0);
  });
});

test('embedQuery: 2e appel avec la même question n\'embed rien (cache par hash)', async () => {
  await withTmpHome(async (home) => {
    const { embedQuery } = await import('../lib/embed.mjs');

    const embedder1 = spyEmbedder();
    const v1 = await embedQuery('daemon de sync', embedder1);
    assert.equal(embedder1.calls, 1);

    const embedder2 = spyEmbedder();
    const v2 = await embedQuery('daemon de sync', embedder2);
    assert.equal(embedder2.calls, 0, 'question déjà en cache, aucun embed() ne devrait être appelé');
    assert.deepEqual(Array.from(v2), Array.from(v1));

    const cacheDir = path.join(home, 'cache', 'queries');
    assert.equal(fs.readdirSync(cacheDir).length, 1);
  });
});

test('embedQuery: question différente -> ré-embed, cache séparé', async () => {
  await withTmpHome(async () => {
    const { embedQuery } = await import('../lib/embed.mjs');
    const embedder = spyEmbedder();
    await embedQuery('question A', embedder);
    assert.equal(embedder.calls, 1);
    await embedQuery('question B', embedder);
    assert.equal(embedder.calls, 2);
  });
});

test('embedQuery: embedder null -> retourne null sans planter', async () => {
  await withTmpHome(async () => {
    const { embedQuery } = await import('../lib/embed.mjs');
    assert.equal(await embedQuery('question', null), null);
  });
});

test('CALEPIN_NO_EMBED force getEmbedder() à retourner null', async () => {
  const prev = process.env.CALEPIN_NO_EMBED;
  process.env.CALEPIN_NO_EMBED = '1';
  try {
    const { getEmbedder, getEmbedderFailureReason } = await import('../lib/embed.mjs');
    const embedder = await getEmbedder();
    assert.equal(embedder, null);
    assert.equal(getEmbedderFailureReason(), 'CALEPIN_NO_EMBED');
  } finally {
    if (prev === undefined) delete process.env.CALEPIN_NO_EMBED;
    else process.env.CALEPIN_NO_EMBED = prev;
  }
});
