// Boîte centrée par-dessus le layout (voir docs/adr/0004) : tous les overlays
// (:new, :dream, :spaces, ?) partagent ce cadre. `esc` referme est géré par
// l'overlay lui-même (chaque overlay a sa propre logique de touches).
import { Box, Text } from 'ink';
import type { ReactNode } from 'react';

export function OverlayFrame({
  title,
  screenWidth,
  screenHeight,
  widthPct = 0.8,
  heightPct = 0.8,
  color = 'magenta',
  children,
}: {
  title: string;
  screenWidth: number;
  screenHeight: number;
  widthPct?: number;
  heightPct?: number;
  color?: string;
  children: ReactNode;
}) {
  const width = Math.max(30, Math.floor(screenWidth * widthPct));
  const height = Math.max(10, Math.floor(screenHeight * heightPct));
  const top = Math.max(0, Math.floor((screenHeight - height) / 2));
  const left = Math.max(0, Math.floor((screenWidth - width) / 2));

  return (
    <Box position="absolute" top={top} left={left} width={width} height={height}>
      <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor={color} paddingX={1}>
        <Text bold color={color}>
          {title}
        </Text>
        <Box flexDirection="column" flexGrow={1} marginTop={1}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
