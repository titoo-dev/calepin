// Avant-dernière ligne : mode courant, espace du sujet sélectionné, position
// n/N, hints des touches essentielles (voir docs/adr/0004).
import { Box, Text } from 'ink';
import type { UIState, ViewState } from '../lib/ui-logic.mjs';

const HINTS: Record<UIState['mode'], string> = {
  NORMAL: 'j/k gg/G nav · Tab focus · Enter plein écran · dd suppr · y copie · r recharge · / cherche · : commande · ? aide · q quitter',
  SEARCH: 'tape pour filtrer · Enter recherche hybride · esc annuler',
  COMMAND: 'Enter valider · Tab complétion · ↑/↓ historique · esc annuler',
};

export function StatusBar({ state, view, width }: { state: UIState; view: ViewState; width: number }) {
  const hint =
    state.mode === 'SEARCH' && state.searchPhase === 'results'
      ? 'j/k nav · c copie citation · Enter plein écran · esc retour liste'
      : HINTS[state.mode];

  const space = view.current ? (view.current as { space: string }).space : '—';
  const position = view.length === 0 ? '0/0' : `${state.cursor + 1}/${view.length}`;
  const searching = state.busy && state.pendingEffect?.type === 'RUN_QUERY';

  return (
    <Box width={width}>
      <Text>
        <Text bold color={state.mode === 'NORMAL' ? 'green' : state.mode === 'SEARCH' ? 'yellow' : 'magenta'}>
          {state.mode}
        </Text>
        <Text dimColor> · {space} · {position} · </Text>
        {searching ? (
          <Text color="yellow">recherche…</Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {hint}
          </Text>
        )}
      </Text>
    </Box>
  );
}
