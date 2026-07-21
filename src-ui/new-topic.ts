// Écran 5 du menu principal : nouveau sujet (voir docs/adr/0004).
// Formulaire clack pur (pas d'ink) : chemin validé en direct, titre,
// keywords bilingues, éléments cal-* un par un, aperçu pretty, confirmation.
import * as p from '@clack/prompts';
import * as store from '../lib/store.mjs';
import { renderPretty } from '../lib/format.mjs';
import { recordTopic, todayISO } from '../lib/ui-logic.mjs';
import { orAbort } from './ui.js';

type Fields = {
  decisions: string[];
  reasons: string[];
  facts: string[];
  rules: string[];
  files: string[];
  links: string[];
  narration: string;
};

const ELEMENT_TYPES = [
  { value: 'decision', label: 'Décision (cal-decision)' },
  { value: 'reason', label: 'Raison (cal-reason)' },
  { value: 'fact', label: 'Fait (cal-fact)' },
  { value: 'rule', label: 'Règle (cal-rule)' },
  { value: 'file', label: 'Fichier concerné (cal-file)' },
  { value: 'link', label: 'Lien vers un autre sujet (cal-link)' },
  { value: 'narration', label: 'Narration libre (paragraphe)' },
  { value: 'done', label: 'Terminer' },
] as const;

const FIELD_BY_TYPE: Record<string, keyof Fields> = {
  decision: 'decisions',
  reason: 'reasons',
  fact: 'facts',
  rule: 'rules',
  file: 'files',
  link: 'links',
};

async function collectElements(): Promise<Fields> {
  const fields: Fields = { decisions: [], reasons: [], facts: [], rules: [], files: [], links: [], narration: '' };
  for (;;) {
    const type = orAbort(await p.select({ message: 'Ajouter un élément ?', options: [...ELEMENT_TYPES] }));
    if (type === 'done') break;
    if (type === 'narration') {
      const text = orAbort(await p.text({ message: 'Narration libre' }));
      fields.narration = fields.narration ? `${fields.narration}\n${text}` : text;
      continue;
    }
    const text = orAbort(await p.text({ message: `Contenu (${type})` }));
    const field = FIELD_BY_TYPE[type];
    (fields[field] as string[]).push(text);
  }
  return fields;
}

/**
 * newTopicForm(cwd, opts) -> true si le sujet a été enregistré.
 * opts.presetKeywords : suggestions pré-remplies (utilisé par dream --mode
 * synthesize, qui appelle ce même formulaire pour la création guidée).
 */
export async function newTopicForm(cwd: string, opts: { presetKeywords?: string[] } = {}): Promise<boolean> {
  const topicPath = orAbort(
    await p.text({
      message: 'Chemin du sujet (categorie/slug)',
      placeholder: 'architecture/exemple',
      validate: (v) => {
        if (!v) return 'requis';
        try {
          store.validateTopicPath(v);
          return undefined;
        } catch (err) {
          return (err as Error).message;
        }
      },
    })
  );

  const title = orAbort(await p.text({ message: 'Titre', validate: (v) => (v ? undefined : 'requis') }));

  const keywordsRaw = orAbort(
    await p.text({
      message: 'Mots-clés (bilingues fr/en obligatoires — le pont cross-langue du retrieval)',
      placeholder: 'auth, authentification, login',
      initialValue: (opts.presetKeywords ?? []).join(', '),
    })
  );
  const keywords = keywordsRaw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  const fields = await collectElements();

  const preview = renderPretty({ title, keywords, created: todayISO(), updated: todayISO(), ...fields });
  p.note(preview, 'Aperçu');

  const confirmed = orAbort(await p.confirm({ message: 'Enregistrer ce sujet ?', initialValue: true }));
  if (!confirmed) return false;

  try {
    const { file, space } = recordTopic(cwd, { topicPath, title, keywords, ...fields, spaceLabel: null });
    p.log.success(`sujet enregistré : ${space}/${topicPath} (${file})`);
    return true;
  } catch (err) {
    p.log.error((err as Error).message);
    return false;
  }
}
