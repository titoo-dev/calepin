// Écran 4 du menu principal : espaces (voir docs/adr/0004).
// Liste espaces actifs + tous les espaces perso ; actions : bind du cwd,
// sync d'un espace perso, création. Clack pur, pas d'ink.
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import * as store from '../lib/store.mjs';
import * as sync from '../lib/sync.mjs';
import { orAbort } from './ui.js';

export async function runSpacesScreen(cwd: string): Promise<void> {
  for (;;) {
    const active = store.activeSpaces(cwd);
    const allPersonal = sync.listPersonalSpaceNames();

    const lines = [
      pc.bold('Actifs pour ce dossier :'),
      ...(active.length ? active.map((s) => `  ${s.label} (${store.listTopics(s).length} sujets)`) : ['  aucun']),
      '',
      pc.bold('Espaces perso disponibles :'),
      ...(allPersonal.length ? allPersonal.map((n) => `  ${n}`) : ['  aucun']),
    ];
    p.note(lines.join('\n'), 'Espaces');

    const action = orAbort(
      await p.select({
        message: 'Action',
        options: [
          { value: 'bind', label: 'Lier ce dossier à un espace perso' },
          { value: 'sync', label: 'Synchroniser un espace perso' },
          { value: 'create', label: 'Créer un nouvel espace perso (sans le lier)' },
          { value: 'back', label: 'Retour' },
        ],
      })
    );

    if (action === 'back') return;

    if (action === 'bind') {
      const options = [
        ...allPersonal.map((n) => ({ value: n, label: n })),
        { value: '__new__', label: '(nouveau nom)' },
      ];
      let name = orAbort(await p.select({ message: 'Espace à lier', options }));
      if (name === '__new__') {
        name = orAbort(await p.text({ message: 'Nom du nouvel espace', validate: (v) => (v ? undefined : 'requis') }));
      }
      if (name) {
        store.bind(cwd, name);
        p.log.success(`"${name}" lié à ${cwd}`);
      }
      continue;
    }

    if (action === 'create') {
      const name = orAbort(await p.text({ message: 'Nom du nouvel espace perso', validate: (v) => (v ? undefined : 'requis') }));
      if (name) {
        fs.mkdirSync(path.join(store.home(), 'spaces', name, 'topics'), { recursive: true });
        p.log.success(`espace perso "${name}" créé (non lié à ce dossier — "Lier" pour l'activer ici)`);
      }
      continue;
    }

    if (action === 'sync') {
      if (allPersonal.length === 0) {
        p.log.warn('aucun espace perso à synchroniser');
        continue;
      }
      const name = orAbort(
        await p.select({ message: 'Espace à synchroniser', options: allPersonal.map((n) => ({ value: n, label: n })) })
      );
      const s = p.spinner();
      s.start(`sync ${name}…`);
      const result = sync.syncSpace(name);
      s.stop(result.message);
    }
  }
}
