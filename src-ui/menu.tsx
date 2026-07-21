// Menu principal `calepin ui` (voir docs/adr/0004).
import * as p from '@clack/prompts';
import * as store from '../lib/store.mjs';
import { banner, spacesSummary, orAbort } from './ui.js';
import { runBrowseScreen } from './browse.js';
import { runSearchScreen } from './search.js';
import { runDreamScreen } from './dream.js';
import { runSpacesScreen } from './spaces.js';
import { newTopicForm } from './new-topic.js';

export async function runUi(): Promise<void> {
  const cwd = process.cwd();
  console.log(banner());
  p.intro('menu principal');

  for (;;) {
    const spaces = store.activeSpaces(cwd).map((s) => ({ label: s.label, topics: store.listTopics(s).length }));
    console.log(spacesSummary(spaces) + '\n');

    const choice = orAbort(
      await p.select({
        message: 'calepin',
        options: [
          { value: 'browse', label: 'Parcourir les sujets' },
          { value: 'search', label: 'Rechercher' },
          { value: 'dream', label: 'Consolider (dream)' },
          { value: 'spaces', label: 'Espaces' },
          { value: 'new', label: 'Nouveau sujet' },
          { value: 'quit', label: 'Quitter' },
        ],
      })
    );

    switch (choice) {
      case 'quit':
        p.outro('à bientôt');
        return;
      case 'browse':
        await runBrowseScreen(cwd);
        break;
      case 'search':
        await runSearchScreen(cwd);
        break;
      case 'dream':
        await runDreamScreen(cwd);
        break;
      case 'spaces':
        await runSpacesScreen(cwd);
        break;
      case 'new':
        await newTopicForm(cwd);
        break;
    }
  }
}
