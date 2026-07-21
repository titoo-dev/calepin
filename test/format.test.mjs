import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopic, serializeTopic, renderPretty } from '../lib/format.mjs';

test('roundtrip: serialize -> parse restitue le même objet', () => {
  const obj = {
    title: 'Auth — flux desktop',
    keywords: ['auth', 'authentification', 'oauth'],
    created: '2026-07-21',
    updated: '2026-07-21',
    decisions: ['Refresh token en keychain, jamais sur disque.'],
    reasons: ['Fuite historique via logs (2025-11).'],
    facts: ['Le daemon tourne en user-space.', 'Refresh toutes les 45 min.'],
    rules: ['Ne jamais logger le refresh token.'],
    files: ['src/auth/daemon.ts'],
    links: ['architecture/overview'],
    narration: 'Narration libre sur deux\nparagraphes distincts.',
  };

  const html = serializeTopic(obj);
  const parsed = parseTopic(html);
  assert.deepEqual(parsed, obj);
});

test('serialize produit un élément par ligne avec indentation 2 espaces', () => {
  const html = serializeTopic({
    title: 'T',
    keywords: ['a'],
    created: '2026-01-01',
    updated: '2026-01-01',
    decisions: ['D1'],
    reasons: [],
    facts: [],
    rules: [],
    files: [],
    links: [],
    narration: '',
  });
  const lines = html.split('\n').filter((l) => l.length > 0);
  assert.equal(lines[0], '<cal-topic title="T" keywords="a" created="2026-01-01" updated="2026-01-01">');
  assert.equal(lines[1], '  <cal-decision>D1</cal-decision>');
  assert.equal(lines[2], '</cal-topic>');
});

test('rejette une balise cal-* inconnue', () => {
  const html = [
    '<cal-topic title="T" keywords="" created="2026-01-01" updated="2026-01-01">',
    '<cal-bogus>oops</cal-bogus>',
    '</cal-topic>',
  ].join('\n');
  assert.throws(() => parseTopic(html), /inconnue/);
});

test('rejette une structure sans racine unique (pas de fermeture)', () => {
  const html = '<cal-topic title="T" keywords="" created="2026-01-01" updated="2026-01-01">\n<cal-fact>x</cal-fact>';
  assert.throws(() => parseTopic(html));
});

test('échappe les entités dans les attributs et le texte à la sérialisation', () => {
  const obj = {
    title: 'Guillemets "et" <balises> & esperluette',
    keywords: [],
    created: '2026-01-01',
    updated: '2026-01-01',
    decisions: ['a < b && b > c'],
    reasons: [],
    facts: [],
    rules: [],
    files: [],
    links: [],
    narration: '',
  };
  const html = serializeTopic(obj);
  assert.ok(!html.includes('Guillemets "et" <balises>'), 'les caractères bruts ne doivent pas fuiter tels quels');
  assert.ok(html.includes('&quot;et&quot;'));
  assert.ok(html.includes('&lt;balises&gt;'));
  assert.ok(html.includes('&amp;'));

  const parsed = parseTopic(html);
  assert.equal(parsed.title, obj.title);
  assert.equal(parsed.decisions[0], obj.decisions[0]);
});

test('renderPretty: titre + sections labellisées + narration, texte simple sans balises', () => {
  const obj = parseTopic(
    serializeTopic({
      title: 'Auth — daemon',
      keywords: ['auth', 'daemon'],
      created: '2026-07-01',
      updated: '2026-07-10',
      decisions: ['On garde le refresh en keychain.'],
      reasons: ['Fuite historique.'],
      facts: ['Le daemon tourne en user-space.'],
      rules: ['Jamais logger le token.'],
      files: ['src/auth/daemon.ts'],
      links: ['architecture/overview'],
      narration: 'Une phrase de narration libre.',
    })
  );

  const out = renderPretty(obj);
  assert.match(out, /^Auth — daemon\n/);
  assert.match(out, /mots-clés: auth, daemon/);
  assert.match(out, /créé: 2026-07-01, mis à jour: 2026-07-10/);
  assert.match(out, /Décision:\n {2}- On garde le refresh en keychain\./);
  assert.match(out, /Raison:\n {2}- Fuite historique\./);
  assert.match(out, /Faits:\n {2}- Le daemon tourne en user-space\./);
  assert.match(out, /Règles:\n {2}- Jamais logger le token\./);
  assert.match(out, /Fichiers:\n {2}- src\/auth\/daemon\.ts/);
  assert.match(out, /Liens:\n {2}- architecture\/overview/);
  assert.match(out, /Narration:\n {2}Une phrase de narration libre\./);
  assert.ok(!out.includes('<cal-'), 'aucune balise cal-* ne doit apparaître dans le rendu');
});

test('renderPretty: sujet minimal (rien que le titre) ne plante pas', () => {
  const out = renderPretty({
    title: 'Vide',
    keywords: [],
    created: '',
    updated: '',
    decisions: [],
    reasons: [],
    facts: [],
    rules: [],
    files: [],
    links: [],
    narration: '',
  });
  assert.equal(out, 'Vide\n');
});
