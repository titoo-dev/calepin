// Panneau preview (droite, ~60%, ou plein écran) : rendu pretty du sujet sous
// le curseur, scrollable (voir docs/adr/0004). En mode résultats, le hit
// n'a pas `obj` — on relit le sujet complet via readTopicByKey.
import { Box, Text } from 'ink';
import { renderPretty } from '../lib/format.mjs';
import { readTopicByKey } from '../lib/ui-logic.mjs';
import type { ViewState } from '../lib/ui-logic.mjs';
import { PrettyLines } from './pretty-lines.js';

function currentTopicObj(cwd: string, view: ViewState) {
  if (!view.current) return null;
  if (view.resultsMode) {
    const hit = view.current as { space: string; path: string };
    const topic = readTopicByKey(cwd, `${hit.space}/${hit.path}`);
    return topic?.obj ?? null;
  }
  return (view.current as { obj: unknown }).obj;
}

export function Preview({
  cwd,
  view,
  focused,
  scroll,
  width,
  height,
}: {
  cwd: string;
  view: ViewState;
  focused: boolean;
  scroll: number;
  width: number;
  height: number;
}) {
  const obj = currentTopicObj(cwd, view);
  const text = obj ? renderPretty(obj as Parameters<typeof renderPretty>[0]) : null;
  const contentHeight = Math.max(1, height - 2); // -2 : borderStyle round (haut+bas)
  const lines = text ? text.split('\n').slice(scroll, scroll + contentHeight) : [];

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={focused ? 'cyan' : 'gray'}
      paddingX={1}
      overflowY="hidden"
    >
      {text ? <PrettyLines text={lines.join('\n')} /> : <Text dimColor>—</Text>}
    </Box>
  );
}
