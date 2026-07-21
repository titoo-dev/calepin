// Overlay `?` : aide complète groupée par mode (voir docs/adr/0004).
import { Box, Text, useInput } from 'ink';
import { OverlayFrame } from './overlay-frame.js';

const SECTIONS: [string, string[]][] = [
  [
    'NORMAL',
    [
      'j/k : monter/descendre',
      'gg / G : début / fin',
      'Ctrl-d / Ctrl-u : demi-page bas/haut',
      '{ / } : namespace précédent/suivant',
      'Tab : bascule focus liste/preview',
      'Enter : preview plein écran (esc/q pour revenir)',
      'dd : supprime le sujet courant (confirmation y/n)',
      'y : copie le chemin (OSC52)',
      'r : recharge le corpus',
      '/ : recherche · : : commande · ? : aide · q : quitter',
    ],
  ],
  [
    'SEARCH (/)',
    [
      'tape : filtre lexical instantané de la liste',
      'Enter : lance la recherche hybride (résultats scorés)',
      'esc : annule, restaure la liste complète',
      'c (sur un résultat) : copie le citation_block',
    ],
  ],
  [
    'COMMAND (:)',
    [
      ':q · :help · :new · :dream merge|link|prune|synthesize',
      ':spaces · :bind <nom> · :sync [nom] · :rm <path>',
      '↑/↓ : historique des commandes · Tab : complétion',
    ],
  ],
];

export function HelpOverlay({
  onClose,
  screenWidth,
  screenHeight,
}: {
  onClose: () => void;
  screenWidth: number;
  screenHeight: number;
}) {
  useInput((input, key) => {
    if (input === 'q' || key.escape || key.return) onClose();
  });

  return (
    <OverlayFrame title="aide" screenWidth={screenWidth} screenHeight={screenHeight} color="cyan">
      {SECTIONS.map(([section, lines]) => (
        <Box key={section} flexDirection="column" marginBottom={1}>
          <Text bold color="cyan">
            {section}
          </Text>
          {lines.map((l) => (
            <Text key={l}> {l}</Text>
          ))}
        </Box>
      ))}
      <Text dimColor>esc / q / entrée : fermer</Text>
    </OverlayFrame>
  );
}
