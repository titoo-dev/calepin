import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../lib/store.mjs';
import {
  groupByNamespace,
  filterTopics,
  mergePlan,
  dreamApplyKind,
  scanSecrets,
  splitTopicKey,
  loadTopics,
  applyMerge,
  applyLink,
  applyPrune,
  recordTopic,
} from '../lib/ui-logic.mjs';

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
}

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
}

function withHome(home, fn) {
  const prev = process.env.CALEPIN_HOME;
  process.env.CALEPIN_HOME = home;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CALEPIN_HOME;
    else process.env.CALEPIN_HOME = prev;
  }
}

test('groupByNamespace: groupe par 1er segment, trie namespaces puis chemins', () => {
  const topics = [
    { space: 'equipe', path: 'conventions/b', obj: {} },
    { space: 'equipe', path: 'architecture/a', obj: {} },
    { space: 'equipe', path: 'architecture/z', obj: {} },
  ];
  const groups = groupByNamespace(topics);
  assert.deepEqual(
    groups.map((g) => g.namespace),
    ['architecture', 'conventions']
  );
  assert.deepEqual(
    groups[0].items.map((t) => t.path),
    ['architecture/a', 'architecture/z']
  );
});

test('filterTopics: sous-chaîne insensible casse/accents sur chemin/titre/keywords', () => {
  const topics = [
    { space: 'equipe', path: 'auth/daemon', obj: { title: 'Authentification', keywords: ['oauth'] } },
    { space: 'equipe', path: 'notes/cafe', obj: { title: 'Préférences café', keywords: ['café'] } },
  ];
  assert.deepEqual(
    filterTopics(topics, 'CAFE').map((t) => t.path),
    ['notes/cafe']
  );
  assert.deepEqual(
    filterTopics(topics, 'oauth').map((t) => t.path),
    ['auth/daemon']
  );
  assert.equal(filterTopics(topics, '').length, 2);
  assert.equal(filterTopics(topics, 'kubernetes').length, 0);
});

test('mergePlan: garde le sujet avec le plus d\'éléments typés', () => {
  const rich = { space: 'equipe', path: 'a', obj: { decisions: ['x'], facts: ['y', 'z'] } };
  const poor = { space: 'equipe', path: 'b', obj: { facts: ['y'] } };
  assert.deepEqual(mergePlan(rich, poor), { keep: rich, drop: poor });
  assert.deepEqual(mergePlan(poor, rich), { keep: rich, drop: poor });
});

test('mergePlan: égalité -> le premier gagne', () => {
  const a = { space: 'equipe', path: 'a', obj: { facts: ['y'] } };
  const b = { space: 'equipe', path: 'b', obj: { facts: ['z'] } };
  assert.deepEqual(mergePlan(a, b), { keep: a, drop: b });
});

test('dreamApplyKind: passthrough sur les 4 modes valides, jette sinon', () => {
  for (const mode of ['merge', 'link', 'prune', 'synthesize']) {
    assert.equal(dreamApplyKind(mode), mode);
  }
  assert.throws(() => dreamApplyKind('bogus'), /mode inconnu/);
});

test('scanSecrets: détecte les motifs connus, null sinon', () => {
  assert.equal(scanSecrets('rien ici'), null);
  assert.match(scanSecrets('clé AKIAABCDEFGHIJKLMNOP'), /AWS/);
  assert.match(scanSecrets('password: hunter2'), /mot de passe/);
});

test('splitTopicKey: split sur le 1er "/" seulement', () => {
  assert.deepEqual(splitTopicKey('perso:foo/auth/daemon'), { space: 'perso:foo', path: 'auth/daemon' });
  assert.deepEqual(splitTopicKey('equipe/a'), { space: 'equipe', path: 'a' });
});

test('recordTopic + loadTopics + applyMerge : round-trip disque', () => {
  const home = tmpHome();
  const proj = tmpProject();
  withHome(home, () => {
    store.bind(proj, 'ui-test');
    const cwd = proj;

    recordTopic(cwd, {
      topicPath: 'auth/daemon',
      title: 'Auth daemon',
      keywords: ['auth', 'daemon'],
      decisions: ['Refresh en keychain.'],
      facts: ['Daemon en user-space.'],
      spaceLabel: null,
    });
    recordTopic(cwd, {
      topicPath: 'auth/daemon-bis',
      title: 'Auth daemon bis',
      keywords: ['auth', 'daemon'],
      facts: [],
      spaceLabel: null,
    });

    const topics = loadTopics(cwd);
    assert.equal(topics.length, 2);
    const richKey = 'perso:ui-test/auth/daemon';
    const poorKey = 'perso:ui-test/auth/daemon-bis';

    const plan = mergePlan(
      topics.find((t) => `${t.space}/${t.path}` === richKey),
      topics.find((t) => `${t.space}/${t.path}` === poorKey)
    );
    assert.equal(`${plan.drop.space}/${plan.drop.path}`, poorKey);

    const removed = applyMerge(cwd, poorKey);
    assert.equal(removed, true);
    assert.equal(loadTopics(cwd).length, 1);
  });
});

test('recordTopic: secret dans une décision refusé', () => {
  const home = tmpHome();
  const proj = tmpProject();
  withHome(home, () => {
    store.bind(proj, 'ui-secret-test');
    assert.throws(
      () =>
        recordTopic(proj, {
          topicPath: 'notes/oops',
          title: 'Oops',
          keywords: ['x'],
          decisions: ['clé AKIAABCDEFGHIJKLMNOP en dur'],
          spaceLabel: null,
        }),
      /secret détecté/
    );
  });
});

test('applyLink: ajoute un cal-link réciproque entre 2 sujets', () => {
  const home = tmpHome();
  const proj = tmpProject();
  withHome(home, () => {
    store.bind(proj, 'ui-link-test');
    recordTopic(proj, { topicPath: 'a/one', title: 'One', keywords: ['x'], spaceLabel: null });
    recordTopic(proj, { topicPath: 'a/two', title: 'Two', keywords: ['x'], spaceLabel: null });

    const keyA = 'perso:ui-link-test/a/one';
    const keyB = 'perso:ui-link-test/a/two';
    applyLink(proj, [keyA, keyB]);

    const topics = loadTopics(proj);
    const one = topics.find((t) => t.path === 'a/one');
    const two = topics.find((t) => t.path === 'a/two');
    assert.ok(one.obj.links.includes('a/two'));
    assert.ok(two.obj.links.includes('a/one'));
  });
});

test('applyPrune: supprime le sujet candidat', () => {
  const home = tmpHome();
  const proj = tmpProject();
  withHome(home, () => {
    store.bind(proj, 'ui-prune-test');
    recordTopic(proj, { topicPath: 'notes/dead', title: 'Dead', keywords: ['x'], spaceLabel: null });
    const removed = applyPrune(proj, 'perso:ui-prune-test/notes/dead');
    assert.equal(removed, true);
    assert.equal(loadTopics(proj).length, 0);
  });
});
