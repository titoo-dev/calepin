// Overlay `:spaces` : espaces actifs + perso, bind cwd, sync, créer (voir
// docs/adr/0004). Remplace l'ancien écran clack spaces.ts (mort).
import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import * as store from '../../lib/store.mjs';
import * as sync from '../../lib/sync.mjs';
import { OverlayFrame } from './overlay-frame.js';

type Prompt = { purpose: 'bind' | 'create'; buffer: string } | null;

export function SpacesOverlay({
  cwd,
  onClose,
  screenWidth,
  screenHeight,
}: {
  cwd: string;
  onClose: (reload: boolean) => void;
  screenWidth: number;
  screenHeight: number;
}) {
  const [active, setActive] = useState(() =>
    store.activeSpaces(cwd).map((s) => ({ label: s.label, topics: store.listTopics(s).length }))
  );
  const [personalNames, setPersonalNames] = useState(() => sync.listPersonalSpaceNames());
  const [cursor, setCursor] = useState(0);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [message, setMessage] = useState('');
  const [reloadNeeded, setReloadNeeded] = useState(false);

  function refresh() {
    setActive(store.activeSpaces(cwd).map((s) => ({ label: s.label, topics: store.listTopics(s).length })));
    setPersonalNames(sync.listPersonalSpaceNames());
  }

  useInput((input, key) => {
    if (prompt) {
      if (key.escape) {
        setPrompt(null);
        return;
      }
      if (key.return) {
        const name = prompt.buffer.trim();
        if (!name) {
          setPrompt(null);
          return;
        }
        if (prompt.purpose === 'bind') {
          store.bind(cwd, name);
          setMessage(`"${name}" lié à ${cwd}`);
          setReloadNeeded(true);
        } else {
          fs.mkdirSync(path.join(store.home(), 'spaces', name, 'topics'), { recursive: true });
          setMessage(`espace perso "${name}" créé (non lié — "b" pour l'activer ici)`);
        }
        setPrompt(null);
        refresh();
        return;
      }
      if (key.backspace || key.delete) {
        setPrompt({ ...prompt, buffer: prompt.buffer.slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setPrompt({ ...prompt, buffer: prompt.buffer + input });
      }
      return;
    }

    if (input === 'q' || key.escape) {
      onClose(reloadNeeded);
      return;
    }
    if (key.downArrow || input === 'j') setCursor((c) => Math.min(personalNames.length - 1, c + 1));
    if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
    if (input === 'b') setPrompt({ purpose: 'bind', buffer: '' });
    if (input === 'n') setPrompt({ purpose: 'create', buffer: '' });
    if (input === 's') {
      const name = personalNames[cursor];
      if (!name) {
        setMessage('aucun espace perso à synchroniser');
        return;
      }
      setMessage(`sync ${name}…`);
      const result = sync.syncSpace(name);
      setMessage(result.message);
    }
  });

  return (
    <OverlayFrame title="espaces" screenWidth={screenWidth} screenHeight={screenHeight} color="blue">
      <Text bold>Actifs pour ce dossier :</Text>
      {active.length === 0 && <Text dimColor> aucun</Text>}
      {active.map((s) => (
        <Text key={s.label}> {s.label} ({s.topics} sujets)</Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Espaces perso disponibles :</Text>
        {personalNames.length === 0 && <Text dimColor> aucun</Text>}
        {personalNames.map((n, i) => (
          <Text key={n} inverse={i === cursor && !prompt}>
            {' '}
            {n}
          </Text>
        ))}
      </Box>
      {prompt && (
        <Box marginTop={1}>
          <Text>
            {prompt.purpose === 'bind' ? 'Lier ce dossier à : ' : 'Nom du nouvel espace : '}
            {prompt.buffer}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {!prompt && message && (
        <Box marginTop={1}>
          <Text dimColor wrap="truncate-end">
            {message}
          </Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>b lier · s sync · n créer · esc fermer</Text>
      </Box>
    </OverlayFrame>
  );
}
