// Écran 1 du menu principal : parcourir les sujets (voir docs/adr/0004).
// Navigation ink (flèches, filtre par frappe), panneau de droite = pretty.
import { useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { renderPretty } from '../lib/format.mjs';
import { loadTopics, groupByNamespace, filterTopics, applyPrune } from '../lib/ui-logic.mjs';
import { orAbort } from './ui.js';

type Topic = { space: string; path: string; obj: any; raw: string };
type ExitAction = { type: 'back' } | { type: 'delete'; topic: Topic };

function PrettyLines({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </>
  );
}

function BrowseApp({ topics, onExit }: { topics: Topic[]; onExit: (a: ExitAction) => void }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const filtered = filterTopics(topics, query);
  const groups = groupByNamespace(filtered);
  const flat = groups.flatMap((g: { items: Topic[] }) => g.items);
  const current: Topic | undefined = flat[Math.min(selected, flat.length - 1)];

  useInput((input, key) => {
    if (fullscreen) {
      if (input === 'q' || key.escape || key.return) setFullscreen(false);
      return;
    }
    if (input === 'q' || key.escape) {
      exit();
      onExit({ type: 'back' });
      return;
    }
    if (key.return && current) {
      setFullscreen(true);
      return;
    }
    if (input === 'd' && current) {
      exit();
      onExit({ type: 'delete', topic: current });
      return;
    }
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(flat.length - 1, i + 1));
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setSelected(0);
    } else if (input && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setSelected(0);
    }
  });

  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;
  const listWidth = Math.min(34, Math.max(24, Math.floor(cols * 0.32)));

  if (fullscreen && current) {
    return (
      <Box flexDirection="column" height={rows}>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="cyan" paddingX={1}>
          <PrettyLines text={renderPretty(current.obj)} />
        </Box>
        <Text dimColor>q / entrée / esc : retour</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>filtre: {query || pc.dim('(tape pour filtrer)')}</Text>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={listWidth} borderStyle="round" borderColor="gray" paddingX={1}>
          {groups.length === 0 && <Text dimColor>aucun sujet</Text>}
          {groups.map((g: { namespace: string; items: Topic[] }) => (
            <Box key={g.namespace} flexDirection="column" marginBottom={1}>
              <Text bold color="cyan">
                {g.namespace}/
              </Text>
              {g.items.map((t) => {
                const idx = flat.indexOf(t);
                const label = t.path.slice(g.namespace.length + 1) || t.path;
                return (
                  <Text key={`${t.space}/${t.path}`} inverse={idx === selected} wrap="truncate-end">
                    {label} <Text dimColor>[{t.space}]</Text>
                  </Text>
                );
              })}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
          {current ? <PrettyLines text={renderPretty(current.obj)} /> : <Text dimColor>—</Text>}
        </Box>
      </Box>
      <Text dimColor wrap="truncate-end">
        ↑/↓ naviguer · tape pour filtrer · entrée plein écran · d supprimer · q/esc retour
      </Text>
    </Box>
  );
}

export async function runBrowseScreen(cwd: string): Promise<void> {
  for (;;) {
    const topics = loadTopics(cwd);
    const action = await new Promise<ExitAction>((resolve) => {
      const app = render(<BrowseApp topics={topics} onExit={resolve} />, { exitOnCtrlC: false });
      void app.waitUntilExit();
    });

    if (action.type === 'back') return;

    const key = `${action.topic.space}/${action.topic.path}`;
    const confirmed = orAbort(await p.confirm({ message: `Supprimer "${key}" ?`, initialValue: false }));
    if (confirmed) {
      // réutilise applyPrune (suppression par clé) — même opération que dream --mode prune.
      if (applyPrune(cwd, key)) p.log.success(`sujet supprimé : ${key}`);
    }
  }
}
