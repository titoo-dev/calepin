// Overlay `:new` : formulaire ink champ par champ (voir docs/adr/0004).
// Remplace l'ancien écran clack new-topic.ts (mort) — réutilisé tel quel par
// l'overlay dream synthesize (opts.presetKeywords).
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import * as store from '../../lib/store.mjs';
import { renderPretty } from '../../lib/format.mjs';
import { recordTopic, todayISO } from '../../lib/ui-logic.mjs';
import { PrettyLines } from '../pretty-lines.js';
import { OverlayFrame } from './overlay-frame.js';

type Fields = {
  decisions: string[];
  reasons: string[];
  facts: string[];
  rules: string[];
  files: string[];
  links: string[];
  narration: string;
};

type Step = 'path' | 'title' | 'keywords' | 'elements' | 'element-type' | 'element-text';

const ELEMENT_TYPES: { value: keyof Fields | 'narration'; label: string }[] = [
  { value: 'decisions', label: 'Décision (cal-decision)' },
  { value: 'reasons', label: 'Raison (cal-reason)' },
  { value: 'facts', label: 'Fait (cal-fact)' },
  { value: 'rules', label: 'Règle (cal-rule)' },
  { value: 'files', label: 'Fichier concerné (cal-file)' },
  { value: 'links', label: 'Lien vers un autre sujet (cal-link)' },
  { value: 'narration', label: 'Narration libre (paragraphe)' },
];

const EMPTY_FIELDS: Fields = { decisions: [], reasons: [], facts: [], rules: [], files: [], links: [], narration: '' };

export function NewTopicOverlay({
  cwd,
  presetKeywords = [],
  onClose,
  screenWidth,
  screenHeight,
}: {
  cwd: string;
  presetKeywords?: string[];
  onClose: (saved: boolean) => void;
  screenWidth: number;
  screenHeight: number;
}) {
  const [step, setStep] = useState<Step>('path');
  const [topicPath, setTopicPath] = useState('');
  const [pathError, setPathError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [keywordsRaw, setKeywordsRaw] = useState(presetKeywords.join(', '));
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [elementType, setElementType] = useState(0);
  const [elementText, setElementText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const keywords = keywordsRaw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  function validatePath(v: string): string | null {
    if (!v) return 'requis';
    try {
      store.validateTopicPath(v);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }

  function save() {
    try {
      const { file, space } = recordTopic(cwd, { topicPath, title, keywords, ...fields, spaceLabel: null });
      onClose(true);
      void file;
      void space;
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useInput((input, key) => {
    if (step === 'path') {
      if (key.escape) return onClose(false);
      if (key.return) {
        const err = validatePath(topicPath);
        setPathError(err);
        if (!err) setStep('title');
        return;
      }
      if (key.backspace || key.delete) {
        setTopicPath((v) => v.slice(0, -1));
        setPathError(null);
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setTopicPath((v) => v + input);
        setPathError(null);
      }
      return;
    }

    if (step === 'title') {
      if (key.escape) return onClose(false);
      if (key.return && title.trim()) return setStep('keywords');
      if (key.backspace || key.delete) return setTitle((v) => v.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setTitle((v) => v + input);
      return;
    }

    if (step === 'keywords') {
      if (key.escape) return onClose(false);
      if (key.return) return setStep('elements');
      if (key.backspace || key.delete) return setKeywordsRaw((v) => v.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setKeywordsRaw((v) => v + input);
      return;
    }

    if (step === 'elements') {
      if (key.escape) return onClose(false);
      if (key.ctrl && input === 's') return save();
      if (input === 'a') {
        setElementType(0);
        setElementText('');
        return setStep('element-type');
      }
      return;
    }

    if (step === 'element-type') {
      if (key.escape) return setStep('elements');
      if (key.downArrow || input === 'j') return setElementType((i) => Math.min(ELEMENT_TYPES.length - 1, i + 1));
      if (key.upArrow || input === 'k') return setElementType((i) => Math.max(0, i - 1));
      if (key.return) {
        setElementText('');
        return setStep('element-text');
      }
      return;
    }

    if (step === 'element-text') {
      if (key.escape) return setStep('elements');
      if (key.return) {
        const type = ELEMENT_TYPES[elementType].value;
        if (elementText.trim()) {
          setFields((f) =>
            type === 'narration'
              ? { ...f, narration: f.narration ? `${f.narration}\n${elementText}` : elementText }
              : { ...f, [type]: [...(f[type] as string[]), elementText] }
          );
        }
        return setStep('elements');
      }
      if (key.backspace || key.delete) return setElementText((v) => v.slice(0, -1));
      if (input && !key.ctrl && !key.meta) setElementText((v) => v + input);
      return;
    }
  });

  const preview = renderPretty({ title, keywords, created: todayISO(), updated: todayISO(), ...fields });

  return (
    <OverlayFrame title="nouveau sujet" screenWidth={screenWidth} screenHeight={screenHeight} color="green">
      {step === 'path' && (
        <Box flexDirection="column">
          <Text>Chemin du sujet (categorie/slug) :</Text>
          <Text>
            {topicPath || <Text dimColor>architecture/exemple</Text>}
            <Text inverse> </Text>
          </Text>
          {pathError && <Text color="red">{pathError}</Text>}
        </Box>
      )}
      {step === 'title' && (
        <Box flexDirection="column">
          <Text dimColor>{topicPath}</Text>
          <Text>Titre :</Text>
          <Text>
            {title}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {step === 'keywords' && (
        <Box flexDirection="column">
          <Text dimColor>{topicPath} — {title}</Text>
          <Text>Mots-clés (bilingues fr/en — pont cross-langue du retrieval) :</Text>
          <Text>
            {keywordsRaw}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {(step === 'elements' || step === 'element-type' || step === 'element-text') && (
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" width={Math.floor(screenWidth * 0.35)} marginRight={1}>
            <Text bold>Éléments</Text>
            {(Object.keys(fields) as (keyof Fields)[]).flatMap((k) =>
              k === 'narration'
                ? fields.narration
                  ? [
                      <Text key="narration" wrap="truncate-end">
                        narration: {fields.narration}
                      </Text>,
                    ]
                  : []
                : (fields[k] as string[]).map((v, i) => (
                    <Text key={`${k}-${i}`} wrap="truncate-end">
                      {k}: {v}
                    </Text>
                  ))
            )}
            {step === 'element-type' && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>Ajouter :</Text>
                {ELEMENT_TYPES.map((t, i) => (
                  <Text key={t.value} inverse={i === elementType}>
                    {t.label}
                  </Text>
                ))}
              </Box>
            )}
            {step === 'element-text' && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold>{ELEMENT_TYPES[elementType].label}</Text>
                <Text>
                  {elementText}
                  <Text inverse> </Text>
                </Text>
              </Box>
            )}
          </Box>
          <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
            <PrettyLines text={preview} />
          </Box>
        </Box>
      )}
      {error && <Text color="red">{error}</Text>}
      <Box marginTop={1}>
        <Text dimColor>
          {step === 'elements'
            ? 'a ajouter · Ctrl-S enregistrer · esc annuler'
            : step === 'element-type' || step === 'element-text'
              ? 'entrée valider · esc retour'
              : 'entrée suivant · esc annuler'}
        </Text>
      </Box>
    </OverlayFrame>
  );
}
