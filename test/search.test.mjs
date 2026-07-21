import test from 'node:test';
import assert from 'node:assert/strict';
import {
  search,
  hybridSearch,
  shouldCite,
  citationBlock,
  SHOULD_CITE_MIN,
  COSINE_CITE_MIN,
} from '../lib/search.mjs';

function topic(space, path, obj) {
  return {
    space,
    path,
    obj: {
      title: '',
      keywords: [],
      decisions: [],
      reasons: [],
      facts: [],
      rules: [],
      files: [],
      links: [],
      narration: '',
      ...obj,
    },
  };
}

const corpus = [
  topic('equipe', 'auth/daemon', {
    title: 'Auth — daemon de sync',
    keywords: ['auth', 'daemon', 'oauth', 'refresh token'],
    decisions: ['Refresh token stocké en keychain, jamais sur disque.'],
    facts: ['Le daemon tourne en user-space, port dynamique.'],
    narration: 'Le flux OAuth desktop repose sur un daemon local pour le refresh.',
  }),
  topic('equipe', 'conventions/nommage', {
    title: 'Convention de nommage des fichiers',
    keywords: ['nommage', 'fichiers', 'convention'],
    rules: ['Toujours kebab-case pour les slugs de sujets.'],
    narration: 'Les fichiers suivent une convention stricte de nommage.',
  }),
  topic('perso:moi', 'notes/cafe', {
    title: 'Préférences café du matin',
    keywords: ['café', 'préférences'],
    narration: "J'aime le café serré le matin, sans sucre.",
  }),
];

test('la bonne query ranke le bon sujet en premier', () => {
  const hits = search(corpus, 'refresh token daemon oauth', 5);
  assert.ok(hits.length > 0);
  assert.equal(hits[0].path, 'auth/daemon');
  assert.equal(hits[0].space, 'equipe');
});

test('query hors-sujet ne cite rien (should_cite false)', () => {
  const hits = search(corpus, 'kubernetes cluster helm charts', 5);
  assert.equal(shouldCite(hits), false);
});

test('should_cite true et citation_block formé quand le score dépasse le seuil', () => {
  const hits = search(corpus, 'refresh token daemon oauth', 5);
  assert.ok(hits[0].score >= SHOULD_CITE_MIN, `score ${hits[0].score} devrait dépasser ${SHOULD_CITE_MIN}`);
  assert.equal(shouldCite(hits), true);
  const block = citationBlock(hits);
  assert.match(block, /^> Selon \[equipe\/auth\/daemon\] — Auth — daemon de sync:/);
});

test('limit borne le nombre de hits retournés', () => {
  const hits = search(corpus, 'fichiers convention nommage daemon oauth café', 1);
  assert.equal(hits.length, 1);
});

test('hybridSearch: le cosinus seul fait remonter un sujet sans overlap lexical', () => {
  const topics = [
    topic('equipe', 'proche', {
      title: 'Sans rapport lexical',
      narration: 'texte neutre sans le moindre mot en commun avec la question.',
    }),
    topic('equipe', 'loin', {
      title: 'Autre sujet neutre',
      narration: 'texte neutre aussi, aucun mot partagé non plus.',
    }),
  ];
  const queryVector = Float32Array.from([1, 0]);
  const topicVectors = new Map([
    ['equipe/proche', Float32Array.from([1, 0])], // cosinus parfait
    ['equipe/loin', Float32Array.from([0, 1])], // orthogonal
  ]);

  const hits = hybridSearch(topics, 'question totalement etrangere au vocabulaire', {
    limit: 5,
    queryVector,
    topicVectors,
  });
  assert.equal(hits[0].path, 'proche');
  assert.equal(hits[0].cosine, 1);
  assert.ok(hits[0].cosine > hits[1].cosine);
});

test('hybridSearch: RRF combine bm25 et cosinus, hits exposent bm25/cosine bruts', () => {
  const topics = [
    topic('equipe', 'lexical-fort', {
      title: 'Refresh token daemon oauth',
      keywords: ['refresh', 'token', 'daemon', 'oauth'],
      narration: 'refresh token daemon oauth refresh token daemon oauth',
    }),
    topic('equipe', 'semantique-fort', {
      title: 'Sujet sans les mots de la question',
      narration: 'texte totalement different en surface mais semantiquement proche',
    }),
  ];
  const queryVector = Float32Array.from([0, 1]);
  const topicVectors = new Map([
    ['equipe/lexical-fort', Float32Array.from([1, 0])], // cosinus nul avec la query
    ['equipe/semantique-fort', Float32Array.from([0, 1])], // cosinus parfait
  ]);

  const hits = hybridSearch(topics, 'refresh token daemon oauth', { limit: 5, queryVector, topicVectors });
  const lex = hits.find((h) => h.path === 'lexical-fort');
  const sem = hits.find((h) => h.path === 'semantique-fort');
  assert.ok(lex.bm25 > 0);
  assert.equal(lex.cosine, 0);
  assert.equal(sem.bm25, 0);
  assert.equal(sem.cosine, 1);
  assert.ok(hits.length === 2, 'chaque sujet remonte grâce à son signal fort');
});

test('shouldCite hybride: cosinus seul au-dessus du seuil suffit', () => {
  const hits = [{ space: 'equipe', path: 'a', title: 'T', score: 0.02, bm25: 0, cosine: COSINE_CITE_MIN + 0.01, snippet: '' }];
  assert.equal(shouldCite(hits), true);
});

test('shouldCite hybride: bm25 seul au-dessus du seuil suffit', () => {
  const hits = [{ space: 'equipe', path: 'a', title: 'T', score: 0.02, bm25: SHOULD_CITE_MIN + 0.1, cosine: 0, snippet: '' }];
  assert.equal(shouldCite(hits), true);
});

test('shouldCite hybride: aucun des deux au-dessus du seuil -> false', () => {
  const hits = [
    { space: 'equipe', path: 'a', title: 'T', score: 0.02, bm25: SHOULD_CITE_MIN - 0.5, cosine: COSINE_CITE_MIN - 0.1, snippet: '' },
  ];
  assert.equal(shouldCite(hits), false);
});

test('citationBlock hybride cite un hit qui ne passe que le seuil cosinus', () => {
  const hits = [
    { space: 'equipe', path: 'a', title: 'Titre A', score: 0.02, bm25: 0, cosine: COSINE_CITE_MIN + 0.01, snippet: 'extrait' },
  ];
  const block = citationBlock(hits);
  assert.match(block, /^> Selon \[equipe\/a\] — Titre A: extrait/);
});
