import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.join(import.meta.dirname, '..', 'calepin.mjs');

// CALEPIN_NO_EMBED=1 par défaut : les tests e2e restent offline/rapides, pas
// de téléchargement de modèle (voir eval/ pour les tests avec le vrai modèle).
function runCli(args, { cwd, home, input, env = {} }) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home, CALEPIN_NO_EMBED: '1', ...env },
  });
}

test('e2e: bind, record de 3 sujets, query retrouve le bon, read dump le brut', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));

  const bindRes = runCli(['bind', 'e2e-space'], { cwd: projectDir, home });
  assert.equal(bindRes.status, 0, bindRes.stderr);

  const record = (topicPath, title, keywords, body) => {
    const res = runCli(
      ['record', topicPath, '--title', title, '--keywords', keywords, '--html', '-'],
      { cwd: projectDir, home, input: body }
    );
    assert.equal(res.status, 0, res.stderr);
  };

  record(
    'auth/daemon',
    'Auth — daemon de sync',
    'auth,daemon,oauth,refresh',
    '<cal-decision>Refresh token en keychain, jamais sur disque.</cal-decision>\n<cal-fact>Daemon en user-space.</cal-fact>\n<p>Le flux OAuth desktop repose sur ce daemon local.</p>\n'
  );
  record(
    'conventions/nommage',
    'Convention de nommage',
    'nommage,fichiers',
    '<cal-rule>Toujours kebab-case pour les slugs.</cal-rule>\n'
  );
  record(
    'notes/cafe',
    'Préférences café',
    'café,préférences',
    "<p>J'aime le café serré le matin.</p>\n"
  );

  const currentRes = runCli(['current'], { cwd: projectDir, home });
  assert.equal(currentRes.status, 0, currentRes.stderr);
  const current = JSON.parse(currentRes.stdout);
  assert.equal(current.spaces.find((s) => s.label === 'perso:e2e-space').topics, 3);

  const queryRes = runCli(['query', 'refresh token daemon oauth'], { cwd: projectDir, home });
  assert.equal(queryRes.status, 0, queryRes.stderr);
  const out = JSON.parse(queryRes.stdout);
  assert.equal(out.hits[0].path, 'auth/daemon');
  assert.equal(out.should_cite, true);
  assert.match(out.citation_block, /auth\/daemon/);
  assert.equal(out.mode, 'bm25');

  const readRes = runCli(['read', 'auth/daemon'], { cwd: projectDir, home });
  assert.equal(readRes.status, 0, readRes.stderr);
  assert.match(readRes.stdout, /<cal-topic /);
  assert.match(readRes.stdout, /Refresh token en keychain/);

  const readPrettyRes = runCli(['read', 'auth/daemon', '--pretty'], { cwd: projectDir, home });
  assert.equal(readPrettyRes.status, 0, readPrettyRes.stderr);
  assert.ok(!readPrettyRes.stdout.includes('<cal-'), 'pas de balise brute en mode --pretty');
  assert.match(readPrettyRes.stdout, /Auth — daemon de sync/);
  assert.match(readPrettyRes.stdout, /Décision:/);
  assert.match(readPrettyRes.stdout, /Refresh token en keychain, jamais sur disque\./);
});

test('e2e: query hors-sujet renvoie should_cite=false', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'e2e-space-2'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/cafe', '--title', 'Café', '--keywords', 'café', '--html', '-'],
    { cwd: projectDir, home, input: "<p>J'aime le café.</p>\n" }
  );

  const res = runCli(['query', 'kubernetes helm charts deployment'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.should_cite, false);
});

test('e2e: --no-embed force le fallback BM25 même sans CALEPIN_NO_EMBED dans l\'env', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'e2e-no-embed'], { cwd: projectDir, home });
  runCli(
    ['record', 'notes/cafe', '--title', 'Café', '--keywords', 'café', '--html', '-'],
    { cwd: projectDir, home, input: "<p>J'aime le café serré.</p>\n" }
  );

  // Env sans CALEPIN_NO_EMBED : seul le flag --no-embed doit forcer le fallback.
  const res = spawnSync(process.execPath, [CLI, 'query', 'café', '--no-embed'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, CALEPIN_HOME: home },
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, 'bm25');
});

test('e2e: dream --mode merge via CLI (--no-embed) trouve un doublon planté', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calepin-proj-'));
  runCli(['bind', 'dream-space'], { cwd: projectDir, home });

  const record = (topicPath, title, keywords, body) => {
    const res = runCli(
      ['record', topicPath, '--title', title, '--keywords', keywords, '--html', '-'],
      { cwd: projectDir, home, input: body }
    );
    assert.equal(res.status, 0, res.stderr);
  };

  record(
    'auth/daemon',
    'Auth daemon refresh token oauth',
    'auth,daemon,oauth,refresh',
    '<cal-decision>Refresh token en keychain, jamais sur disque.</cal-decision>\n<cal-fact>Daemon en user-space.</cal-fact>\n'
  );
  record(
    'auth/daemon-bis',
    'Auth daemon refresh token oauth bis',
    'auth,daemon,oauth,refresh',
    '<cal-decision>Refresh token en keychain, jamais sur disque, bis.</cal-decision>\n<cal-fact>Daemon en user-space, bis.</cal-fact>\n'
  );
  record(
    'notes/cafe',
    'Préférences café',
    'café,préférences',
    "<p>J'aime le café serré le matin.</p>\n"
  );

  const res = runCli(['dream', '--mode', 'merge', '--min-score', '0.5', '--no-embed'], { cwd: projectDir, home });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.mode, 'merge');
  assert.ok(out.candidates.length > 0, 'le doublon planté doit remonter');
  const top = out.candidates[0];
  assert.ok(top.paths.includes('perso:dream-space/auth/daemon'));
  assert.ok(top.paths.includes('perso:dream-space/auth/daemon-bis'));
  assert.match(top.reason, /jaccard/);
});
