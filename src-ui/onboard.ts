// `calepin onboard` en TTY interactif (voir docs/adr/0004). Non-TTY : le CLI
// utilise cmdOnboard (calepin.mjs) inchangé — ce flow ne le remplace que
// quand un humain est devant un vrai terminal.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import * as store from '../lib/store.mjs';
import { loadTopics, queryMemory } from '../lib/ui-logic.mjs';
import { banner, orAbort } from './ui.js';
import { runUi } from './app.js';

export async function runOnboardTui(flags: { perso?: string }): Promise<void> {
  const cwd = process.cwd();
  console.log(banner());
  p.intro('onboarding');

  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  const root = gitRoot.status === 0 ? gitRoot.stdout.trim() : cwd;
  const topicsDir = path.join(root, '.calepin', 'topics');
  const teamExists = fs.existsSync(topicsDir);

  if (teamExists) {
    p.log.info(`espace équipe déjà présent : ${topicsDir}`);
  } else {
    const createTeam = orAbort(
      await p.confirm({ message: `Créer l'espace équipe (${topicsDir}) ?`, initialValue: true })
    );
    if (createTeam) {
      fs.mkdirSync(topicsDir, { recursive: true });
      p.log.success(`espace équipe créé : ${topicsDir}`);
    }
  }

  let spaces = store.activeSpaces(cwd);
  const hasPerso = spaces.some((s) => s.label.startsWith('perso:'));
  if (flags.perso) {
    store.bind(cwd, flags.perso);
    p.log.success(`espace perso "${flags.perso}" lié`);
  } else if (!hasPerso) {
    const wantPerso = orAbort(await p.confirm({ message: 'Lier un espace perso à ce dossier ?', initialValue: true }));
    if (wantPerso) {
      const name = orAbort(await p.text({ message: "Nom de l'espace perso", placeholder: 'perso' }));
      if (name) {
        store.bind(cwd, name);
        p.log.success(`espace perso "${name}" lié`);
      }
    }
  }

  spaces = store.activeSpaces(cwd);
  p.log.info(`espaces actifs : ${spaces.map((s) => s.label).join(', ') || 'aucun'}`);

  const wantTour = orAbort(await p.confirm({ message: 'Voir un exemple de query ?', initialValue: true }));
  if (wantTour) {
    const topics = loadTopics(cwd);
    if (topics.length === 0) {
      p.note(
        'Le cycle : `calepin query "<termes>"` AVANT une tâche non triviale (les hits sont des contraintes), ' +
          '`calepin record <categorie/slug> ...` APRÈS un travail utile.\n' +
          'Aucun sujet enregistré encore — le prochain record en créera un.',
        'Cycle query/record'
      );
    } else {
      const question = orAbort(
        await p.text({ message: 'Question de test', initialValue: topics[0].obj.title ?? '' })
      );
      const result = await queryMemory({ cwd, question });
      const summary = result.hits.length
        ? result.hits.map((h: any) => `${h.space}/${h.path} — ${h.title} (score ${h.score.toFixed(2)})`).join('\n')
        : 'aucun résultat';
      p.note(summary, 'Résultat de query');
    }
  }

  p.outro(
    [
      pc.dim('Cycle essentiel :'),
      '  calepin query "<termes de la tâche>" --limit 5',
      '  calepin record <categorie/slug> --title "T" --keywords "a,b" --html -',
      '  calepin current',
    ].join('\n')
  );

  const wantUi = orAbort(await p.confirm({ message: 'Ouvrir l\'espace calepin ?', initialValue: true }));
  if (wantUi) await runUi();
}
