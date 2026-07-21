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
  clampCursor,
  moveCursor,
  namespaceStarts,
  jumpNamespace,
  halfPageSize,
  trackDoubleKey,
  visibleList,
  parseCommandLine,
  completeCommandName,
  createInitialState,
  deriveView,
  keyToAction,
  uiReducer,
} from '../lib/ui-logic.mjs';

function noKey(overrides = {}) {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// App plein écran : navigation pure, détection double-frappe, parsing de
// commande, traduction touches -> action, reducer central.

test('clampCursor/moveCursor: bornes [0, length-1], 0 si vide', () => {
  assert.equal(clampCursor(5, 3), 2);
  assert.equal(clampCursor(-1, 3), 0);
  assert.equal(clampCursor(1, 0), 0);
  assert.equal(moveCursor(1, 5, 2), 3);
  assert.equal(moveCursor(0, 5, -1), 0);
  assert.equal(moveCursor(4, 5, 1), 4);
});

test('namespaceStarts/jumpNamespace: saute au début du groupe précédent/suivant', () => {
  const groups = [
    { namespace: 'a', items: [{}, {}] },
    { namespace: 'b', items: [{}] },
    { namespace: 'c', items: [{}, {}, {}] },
  ];
  assert.deepEqual(namespaceStarts(groups), [0, 2, 3]);
  assert.equal(jumpNamespace(groups, 0, 1), 2);
  assert.equal(jumpNamespace(groups, 2, 1), 3);
  assert.equal(jumpNamespace(groups, 5, 1), 3); // déjà au dernier -> reste
  assert.equal(jumpNamespace(groups, 3, -1), 2);
  assert.equal(jumpNamespace(groups, 2, -1), 0);
  assert.equal(jumpNamespace(groups, 0, -1), 0); // déjà au premier -> reste
});

test('halfPageSize: moitié arrondie vers le bas, jamais 0', () => {
  assert.equal(halfPageSize(20), 10);
  assert.equal(halfPageSize(1), 1);
  assert.equal(halfPageSize(3), 1);
});

test('trackDoubleKey: 2e frappe identique dans la fenêtre -> triggered', () => {
  const first = trackDoubleKey(null, 'd', 1000);
  assert.equal(first.triggered, false);
  assert.deepEqual(first.pending, { key: 'd', at: 1000 });

  const second = trackDoubleKey(first.pending, 'd', 1200);
  assert.equal(second.triggered, true);
  assert.equal(second.pending, null);
});

test('trackDoubleKey: hors fenêtre ou touche différente -> pas de trigger', () => {
  const first = trackDoubleKey(null, 'g', 1000);
  const tooLate = trackDoubleKey(first.pending, 'g', 1000 + 500);
  assert.equal(tooLate.triggered, false);

  const other = trackDoubleKey(first.pending, 'x', 1050);
  assert.equal(other.triggered, false);
  assert.deepEqual(other.pending, { key: 'x', at: 1050 });
});

test('visibleList: filtre puis groupe (compose filterTopics + groupByNamespace)', () => {
  const topics = [
    { space: 'equipe', path: 'auth/daemon', obj: { title: 'Auth', keywords: [] } },
    { space: 'equipe', path: 'notes/cafe', obj: { title: 'Café', keywords: [] } },
  ];
  const all = visibleList(topics, '');
  assert.equal(all.flat.length, 2);
  const filtered = visibleList(topics, 'cafe');
  assert.deepEqual(filtered.flat.map((t) => t.path), ['notes/cafe']);
  assert.deepEqual(filtered.groups.map((g) => g.namespace), ['notes']);
});

test('parseCommandLine/completeCommandName', () => {
  assert.deepEqual(parseCommandLine(':dream merge'.slice(1)), { name: 'dream', arg: 'merge' });
  assert.deepEqual(parseCommandLine('q'), { name: 'q', arg: '' });
  assert.deepEqual(parseCommandLine('  rm  notes/dead  '), { name: 'rm', arg: 'notes/dead' });
  assert.equal(completeCommandName('sp'), 'spaces');
  assert.equal(completeCommandName('s'), 's'); // sync + spaces -> ambigu, inchangé
  assert.equal(completeCommandName('zzz'), 'zzz');
});

test('deriveView: liste groupée en NORMAL, résultats scorés en SEARCH/results', () => {
  const topics = [
    { space: 'equipe', path: 'a/one', obj: { title: 'One', keywords: [] } },
    { space: 'equipe', path: 'a/two', obj: { title: 'Two', keywords: [] } },
  ];
  const state = { ...createInitialState('/tmp'), topics, cursor: 1 };
  const view = deriveView(state);
  assert.equal(view.resultsMode, false);
  assert.equal(view.length, 2);
  assert.equal(view.current.path, 'a/two');

  const resultsState = {
    ...state,
    mode: 'SEARCH',
    searchPhase: 'results',
    searchResults: [{ space: 'equipe', path: 'a/one', title: 'One', score: 0.9, snippet: '' }],
    cursor: 0,
  };
  const resultsView = deriveView(resultsState);
  assert.equal(resultsView.resultsMode, true);
  assert.equal(resultsView.length, 1);
  assert.equal(resultsView.current.path, 'a/one');
});

test('keyToAction: j/k/gg/G/Ctrl-d/Ctrl-u/{/} en NORMAL', () => {
  const state = { ...createInitialState('/tmp'), topics: [] };
  assert.deepEqual(keyToAction(state, 'j', noKey(), 0), { type: 'MOVE_CURSOR', delta: 1 });
  assert.deepEqual(keyToAction(state, 'k', noKey(), 0), { type: 'MOVE_CURSOR', delta: -1 });
  assert.deepEqual(keyToAction(state, 'G', noKey(), 0), { type: 'JUMP_BOTTOM' });
  assert.deepEqual(keyToAction(state, '}', noKey(), 0), { type: 'JUMP_NAMESPACE', direction: 1 });
  assert.deepEqual(keyToAction(state, '{', noKey(), 0), { type: 'JUMP_NAMESPACE', direction: -1 });
  assert.deepEqual(keyToAction(state, 'd', noKey({ ctrl: true }), 0), { type: 'HALF_PAGE', direction: 1 });
  assert.deepEqual(keyToAction(state, 'u', noKey({ ctrl: true }), 0), { type: 'HALF_PAGE', direction: -1 });

  const g1 = keyToAction(state, 'g', noKey(), 1000);
  assert.equal(g1.type, 'SET_PENDING_KEY');
  const withPending = { ...state, pendingKey: g1.pending };
  assert.deepEqual(keyToAction(withPending, 'g', noKey(), 1100), { type: 'JUMP_TOP' });
});

test('keyToAction: dd demande confirmation via le reducer, y/n la résout', () => {
  const topics = [{ space: 'equipe', path: 'a/one', obj: { title: 'One', keywords: [] } }];
  let state = { ...createInitialState('/tmp'), topics };

  const d1 = keyToAction(state, 'd', noKey(), 1000);
  assert.equal(d1.type, 'SET_PENDING_KEY');
  state = uiReducer(state, d1);

  const d2 = keyToAction(state, 'd', noKey(), 1100);
  assert.equal(d2.type, 'REQUEST_DELETE');
  state = uiReducer(state, d2);
  assert.ok(state.confirm);
  assert.match(state.confirm.message, /supprimer equipe\/a\/one/);

  assert.deepEqual(keyToAction(state, 'y', noKey(), 1200), { type: 'CONFIRM_YES' });
  const resolved = uiReducer(state, { type: 'CONFIRM_YES' });
  assert.equal(resolved.confirm, null);
  assert.deepEqual(resolved.pendingEffect, { type: 'REMOVE_KEY', key: 'equipe/a/one' });
});

test('uiReducer: entrer en SEARCH, filtre live, Enter -> pendingEffect RUN_QUERY', () => {
  const topics = [
    { space: 'equipe', path: 'auth/daemon', obj: { title: 'Auth', keywords: [] } },
    { space: 'equipe', path: 'notes/cafe', obj: { title: 'Café', keywords: [] } },
  ];
  let state = { ...createInitialState('/tmp'), topics };
  state = uiReducer(state, { type: 'ENTER_SEARCH' });
  assert.equal(state.mode, 'SEARCH');
  assert.equal(state.searchPhase, 'typing');

  for (const char of 'cafe') {
    state = uiReducer(state, { type: 'CMDLINE_INPUT', char });
  }
  assert.equal(state.query, 'cafe');
  assert.deepEqual(deriveView(state).flat.map((t) => t.path), ['notes/cafe']);

  state = uiReducer(state, { type: 'CMDLINE_SUBMIT' });
  assert.equal(state.busy, true);
  assert.deepEqual(state.pendingEffect, { type: 'RUN_QUERY', question: 'cafe' });

  const afterResults = uiReducer(state, {
    type: 'EFFECT_RESULT',
    patch: { searchPhase: 'results', searchResults: [{ space: 'equipe', path: 'notes/cafe', title: 'Café', score: 1, snippet: '' }] },
  });
  assert.equal(afterResults.busy, false);
  assert.equal(afterResults.pendingEffect, null);
  assert.equal(afterResults.searchPhase, 'results');

  // esc en mode résultats restaure la liste complète
  const cancelled = uiReducer(afterResults, { type: 'CMDLINE_CANCEL' });
  assert.equal(cancelled.mode, 'NORMAL');
  assert.equal(cancelled.searchResults, null);
  assert.equal(deriveView(cancelled).flat.length, 2);
});

test('uiReducer: mode COMMAND, historique et complétion Tab', () => {
  let state = { ...createInitialState('/tmp'), commandHistory: ['spaces', 'help'] };
  state = uiReducer(state, { type: 'ENTER_COMMAND' });
  for (const char of 'sp') state = uiReducer(state, { type: 'CMDLINE_INPUT', char });
  state = uiReducer(state, { type: 'CMDLINE_TAB' });
  assert.equal(state.cmdline, 'spaces');

  state = uiReducer(state, { type: 'CMDLINE_SUBMIT' });
  assert.equal(state.mode, 'NORMAL');
  assert.deepEqual(state.overlay, { type: 'spaces' });
  assert.deepEqual(state.commandHistory, ['spaces', 'help', 'spaces']);

  state = uiReducer(state, { type: 'CLOSE_OVERLAY' });
  state = uiReducer(state, { type: 'ENTER_COMMAND' });
  state = uiReducer(state, { type: 'CMDLINE_HISTORY', direction: -1 });
  assert.equal(state.cmdline, 'spaces');
  state = uiReducer(state, { type: 'CMDLINE_HISTORY', direction: -1 });
  assert.equal(state.cmdline, 'help');
});

test('uiReducer: commande inconnue -> message erreur, :dream valide un mode', () => {
  let state = { ...createInitialState('/tmp'), mode: 'COMMAND', cmdline: 'bogus' };
  state = uiReducer(state, { type: 'CMDLINE_SUBMIT' });
  assert.equal(state.message.kind, 'error');
  assert.match(state.message.text, /commande inconnue/);

  let dreamState = { ...createInitialState('/tmp'), mode: 'COMMAND', cmdline: 'dream merge' };
  dreamState = uiReducer(dreamState, { type: 'CMDLINE_SUBMIT' });
  assert.deepEqual(dreamState.overlay, { type: 'dream', mode: 'merge' });

  let badDream = { ...createInitialState('/tmp'), mode: 'COMMAND', cmdline: 'dream bogus' };
  badDream = uiReducer(badDream, { type: 'CMDLINE_SUBMIT' });
  assert.equal(badDream.overlay, null);
  assert.match(badDream.message.text, /mode inconnu/);
});

test('uiReducer: :rm demande confirmation, comme dd', () => {
  let state = { ...createInitialState('/tmp'), mode: 'COMMAND', cmdline: 'rm equipe/a/one' };
  state = uiReducer(state, { type: 'CMDLINE_SUBMIT' });
  assert.ok(state.confirm);
  assert.deepEqual(state.confirm.action, { type: 'REMOVE_KEY', key: 'equipe/a/one' });
});

test('uiReducer: ENTER_FULLSCREEN no-op si liste vide, sinon bascule fullscreen', () => {
  const empty = uiReducer({ ...createInitialState('/tmp'), topics: [] }, { type: 'ENTER_FULLSCREEN' });
  assert.equal(empty.fullscreen, false);

  const topics = [{ space: 'equipe', path: 'a/one', obj: { title: 'One', keywords: [] } }];
  const filled = uiReducer({ ...createInitialState('/tmp'), topics }, { type: 'ENTER_FULLSCREEN' });
  assert.equal(filled.fullscreen, true);

  assert.deepEqual(keyToAction(filled, 'q', noKey(), 0), { type: 'EXIT_FULLSCREEN' });
});
