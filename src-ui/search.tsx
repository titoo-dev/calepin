// Écran 2 du menu principal : rechercher (voir docs/adr/0004).
import { useState } from 'react';
import { Box, Text, render, useApp, useInput, useStdout } from 'ink';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { renderPretty } from '../lib/format.mjs';
import { queryMemory, readTopicByKey } from '../lib/ui-logic.mjs';
import { orAbort, copyToClipboard } from './ui.js';

type Hit = { space: string; path: string; title: string; score: number; snippet: string };

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

function SearchApp({
  hits,
  citationBlock,
  cwd,
  onExit,
}: {
  hits: Hit[];
  citationBlock: string;
  cwd: string;
  onExit: () => void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [selected, setSelected] = useState(0);
  const [copyMsg, setCopyMsg] = useState('');
  const current = hits[Math.min(selected, hits.length - 1)];
  const topic = current ? readTopicByKey(cwd, `${current.space}/${current.path}`) : null;

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      onExit();
      return;
    }
    if (key.upArrow) setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow) setSelected((i) => Math.min(hits.length - 1, i + 1));
    if (input === 'c') {
      if (citationBlock) {
        copyToClipboard(citationBlock);
        setCopyMsg('citation_block copié (OSC52) — voir aussi ci-dessous');
      } else {
        setCopyMsg('rien à citer (should_cite=false)');
      }
    }
  });

  const rows = stdout?.rows ?? 24;
  const cols = stdout?.columns ?? 80;
  const listWidth = Math.min(40, Math.max(28, Math.floor(cols * 0.36)));

  return (
    <Box flexDirection="column" height={rows}>
      <Box flexGrow={1}>
        <Box flexDirection="column" width={listWidth} borderStyle="round" borderColor="gray" paddingX={1}>
          {hits.map((h, i) => (
            <Text key={`${h.space}/${h.path}`} inverse={i === selected} wrap="truncate-end">
              {h.title} <Text dimColor>[{h.space}] {h.score.toFixed(2)}</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
          {topic ? <PrettyLines text={renderPretty(topic.obj)} /> : <Text dimColor>—</Text>}
        </Box>
      </Box>
      {copyMsg && <Text dimColor>{copyMsg}</Text>}
      {citationBlock && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <PrettyLines text={citationBlock} />
        </Box>
      )}
      <Text dimColor wrap="truncate-end">
        ↑/↓ naviguer · c copier citation_block · q/esc retour
      </Text>
    </Box>
  );
}

export async function runSearchScreen(cwd: string): Promise<void> {
  const question = orAbort(await p.text({ message: 'Rechercher (langage naturel, fr ou en)' }));
  if (!question || !question.trim()) return;

  const s = p.spinner();
  s.start('recherche…');
  const result = await queryMemory({ cwd, question });
  s.stop(`${result.hits.length} résultat(s) — mode ${result.mode}${result.served ? pc.dim(' (serve)') : ''}`);

  if (result.hits.length === 0) {
    p.log.info('aucun résultat');
    return;
  }

  await new Promise<void>((resolve) => {
    const app = render(
      <SearchApp hits={result.hits} citationBlock={result.citation_block} cwd={cwd} onExit={resolve} />,
      { exitOnCtrlC: false }
    );
    void app.waitUntilExit();
  });
}
