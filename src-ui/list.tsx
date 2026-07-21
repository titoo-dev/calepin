// Panneau liste (gauche, ~40%) : arbre plat indenté par namespace en
// navigation normale, liste de résultats scorés en mode SEARCH/résultats
// (voir docs/adr/0004). Défile pour garder le curseur visible, sans état de
// scroll séparé (recalculé depuis le curseur à chaque rendu).
import { Box, Text } from 'ink';
import type { ViewState } from '../lib/ui-logic.mjs';

type RenderLine = { key: string; kind: 'header' | 'item'; text: string; itemIndex: number | null; muted?: string };

function buildLines(view: ViewState): RenderLine[] {
  if (view.resultsMode) {
    return view.hits.map((h, i) => ({
      key: `${h.space}/${h.path}`,
      kind: 'item' as const,
      text: h.title || h.path,
      itemIndex: i,
      muted: `[${h.space}] ${h.score.toFixed(2)}`,
    }));
  }
  const lines: RenderLine[] = [];
  let idx = 0;
  for (const g of view.groups) {
    lines.push({ key: `ns:${g.namespace}`, kind: 'header', text: `${g.namespace}/`, itemIndex: null });
    for (const t of g.items) {
      const label = t.path.slice(g.namespace.length + 1) || t.path;
      lines.push({ key: `${t.space}/${t.path}`, kind: 'item', text: label, itemIndex: idx, muted: `[${t.space}]` });
      idx++;
    }
  }
  return lines;
}

function windowLines(lines: RenderLine[], cursor: number, height: number): RenderLine[] {
  if (lines.length <= height) return lines;
  const cursorLineIdx = Math.max(
    0,
    lines.findIndex((l) => l.itemIndex === cursor)
  );
  let start = Math.max(0, cursorLineIdx - Math.floor(height / 2));
  start = Math.min(start, lines.length - height);
  return lines.slice(start, start + height);
}

export function TopicList({
  view,
  cursor,
  focused,
  width,
  height,
}: {
  view: ViewState;
  cursor: number;
  focused: boolean;
  width: number;
  height: number;
}) {
  const lines = buildLines(view);
  const contentHeight = Math.max(1, height - 2); // -2 : borderStyle round (haut+bas)
  const visible = windowLines(lines, cursor, contentHeight);

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
      {lines.length === 0 && <Text dimColor>aucun sujet</Text>}
      {visible.map((l) =>
        l.kind === 'header' ? (
          <Text key={l.key} bold color="cyan" wrap="truncate-end">
            {l.text}
          </Text>
        ) : (
          <Text key={l.key} inverse={l.itemIndex === cursor} wrap="truncate-end">
            {l.text} <Text dimColor={l.itemIndex !== cursor}>{l.muted}</Text>
          </Text>
        )
      )}
    </Box>
  );
}
