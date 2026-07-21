// Dernière ligne : `:` et `/` s'y tapent, confirmations (dd, :rm) et messages
// d'état/erreur s'y affichent — façon vim (voir docs/adr/0004).
import { Box, Text } from 'ink';
import type { UIState } from '../lib/ui-logic.mjs';

export function CmdLine({ state, width }: { state: UIState; width: number }) {
  if (state.confirm) {
    return (
      <Box width={width}>
        <Text color="yellow" bold>
          {state.confirm.message}
        </Text>
      </Box>
    );
  }

  if (state.mode === 'SEARCH' || state.mode === 'COMMAND') {
    const prefix = state.mode === 'SEARCH' ? '/' : ':';
    return (
      <Box width={width}>
        <Text>
          {prefix}
          {state.cmdline}
          <Text inverse> </Text>
        </Text>
      </Box>
    );
  }

  if (state.message) {
    return (
      <Box width={width}>
        <Text color={state.message.kind === 'error' ? 'red' : 'green'} wrap="truncate-end">
          {state.message.text}
        </Text>
      </Box>
    );
  }

  return (
    <Box width={width}>
      <Text dimColor>-- NORMAL --</Text>
    </Box>
  );
}
