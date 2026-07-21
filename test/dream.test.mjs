import test from 'node:test';
import assert from 'node:assert/strict';
import { dream, MERGE_MIN, LINK_MIN, PRUNE_MIN, SYNTHESIZE_MIN } from '../lib/dream.mjs';

function topic(space, path, obj) {
  return {
    space,
    path,
    obj: {
      title: '',
      keywords: [],
      created: '2026-01-01',
      updated: '2026-01-01',
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

test('merge: trouve le doublon planté (cosinus quasi parfait)', () => {
  const topics = [
    topic('equipe', 'auth/daemon', { title: 'Auth daemon', keywords: ['auth', 'daemon'] }),
    topic('equipe', 'auth/daemon-v2', { title: 'Auth daemon v2', keywords: ['auth', 'daemon'] }),
    topic('equipe', 'notes/cafe', { title: 'Café du matin', keywords: ['café'] }),
  ];
  const topicVectors = new Map([
    ['equipe/auth/daemon', Float32Array.from([1, 0, 0])],
    ['equipe/auth/daemon-v2', Float32Array.from([0.999, 0.01, 0])],
    ['equipe/notes/cafe', Float32Array.from([0, 0, 1])],
  ]);

  const { candidates } = dream(topics, { mode: 'merge', limit: 10, topicVectors });
  assert.equal(candidates.length, 1);
  assert.deepEqual(new Set(candidates[0].paths), new Set(['equipe/auth/daemon', 'equipe/auth/daemon-v2']));
  assert.ok(candidates[0].score >= MERGE_MIN);
  assert.match(candidates[0].reason, /cosinus/);
});

test('link: paire moyennement similaire remonte, mais pas si déjà cal-link', () => {
  const topics = [
    topic('equipe', 'a', { title: 'A' }),
    topic('equipe', 'b', { title: 'B' }),
    topic('equipe', 'c', { title: 'C', links: ['a'] }), // c -> a, mutuellement lié
  ];
  // a/b : similarité dans la zone link. a/c : même similarité mais déjà liés -> exclu.
  const topicVectors = new Map([
    ['equipe/a', Float32Array.from([1, 0])],
    ['equipe/b', Float32Array.from([0.9, Math.sqrt(1 - 0.9 * 0.9)])],
    ['equipe/c', Float32Array.from([0.9, -Math.sqrt(1 - 0.9 * 0.9)])],
  ]);

  const { candidates } = dream(topics, { mode: 'link', limit: 10, topicVectors });
  const pairKeys = candidates.map((c) => new Set(c.paths));
  assert.ok(pairKeys.some((s) => s.has('equipe/a') && s.has('equipe/b')), 'a/b doit remonter');
  assert.ok(!pairKeys.some((s) => s.has('equipe/a') && s.has('equipe/c')), 'a/c déjà lié doit être exclu');
});

test('prune: classe le sujet mort devant (0 hit, peu d\'éléments, jamais lié, vieux)', () => {
  const topics = [
    topic('equipe', 'vivant/actif', {
      title: 'Sujet actif',
      decisions: ['D1'],
      rules: ['R1'],
      facts: ['F1'],
      updated: '2026-07-01',
    }),
    topic('equipe', 'mort/oublie', {
      title: 'x',
      facts: ['un seul fait'],
      updated: '2025-01-01',
    }),
    topic('equipe', 'vivant/autre', { title: 'Autre actif', links: ['vivant/actif'], updated: '2026-07-10' }),
  ];
  const hits = { 'equipe/vivant/actif': { count: 5, last: '2026-07-15' } };

  const { candidates } = dream(topics, { mode: 'prune', limit: 10, hits });
  assert.ok(candidates.length >= 1);
  assert.equal(candidates[0].paths[0], 'equipe/mort/oublie');
  assert.match(candidates[0].reason, /0 hit query/);
  assert.match(candidates[0].reason, /jamais lié/);
});

test('synthesize: trouve un cluster de 3 sujets proches, même namespace', () => {
  const topics = [
    topic('equipe', 'outils/eslint', { title: 'Config eslint' }),
    topic('equipe', 'outils/prettier', { title: 'Config prettier' }),
    topic('equipe', 'outils/editorconfig', { title: 'Config editorconfig' }),
    topic('equipe', 'architecture/sans-rapport', { title: 'Autre namespace' }),
  ];
  const topicVectors = new Map([
    ['equipe/outils/eslint', Float32Array.from([1, 0, 0])],
    ['equipe/outils/prettier', Float32Array.from([0.95, 0.05, 0])],
    ['equipe/outils/editorconfig', Float32Array.from([0.93, 0, 0.05])],
    ['equipe/architecture/sans-rapport', Float32Array.from([0, 1, 0])],
  ]);

  const { candidates } = dream(topics, { mode: 'synthesize', limit: 10, topicVectors });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].paths.length, 3);
  assert.ok(candidates[0].paths.every((p) => p.startsWith('equipe/outils/')));
});

test('--min-score surcharge le défaut du mode', () => {
  const topics = [
    topic('equipe', 'a', { title: 'A' }),
    topic('equipe', 'b', { title: 'B' }),
  ];
  const topicVectors = new Map([
    ['equipe/a', Float32Array.from([1, 0])],
    ['equipe/b', Float32Array.from([0.8, Math.sqrt(1 - 0.64)])],
  ]);

  const withDefault = dream(topics, { mode: 'merge', limit: 10, topicVectors });
  assert.equal(withDefault.candidates.length, 0, 'sous le seuil merge par défaut');

  const withOverride = dream(topics, { mode: 'merge', limit: 10, topicVectors, minScore: 0.75 });
  assert.equal(withOverride.candidates.length, 1, '--min-score abaissé doit faire remonter la paire');
});

test('sans embeddings, dream retombe sur Jaccard (mode=jaccard dans la raison)', () => {
  const topics = [
    topic('equipe', 'a', { title: 'auth daemon refresh token oauth' }),
    topic('equipe', 'b', { title: 'auth daemon refresh token oauth bis' }),
  ];
  const { candidates } = dream(topics, { mode: 'merge', limit: 10, minScore: 0.7 });
  assert.ok(candidates.length > 0);
  assert.match(candidates[0].reason, /jaccard/);
  assert.match(candidates[0].reason, /embeddings indisponibles/);
});

test('constantes de seuils exportées et dans une échelle plausible', () => {
  assert.ok(LINK_MIN < MERGE_MIN);
  assert.ok(SYNTHESIZE_MIN < MERGE_MIN);
  assert.ok(PRUNE_MIN > 0 && PRUNE_MIN < 1);
});
