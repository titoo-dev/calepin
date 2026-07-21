// Rendu ligne à ligne d'un texte pretty (renderPretty) dans une Box ink,
// tronqué proprement plutôt que wrappé (voir docs/adr/0004). Partagé par
// preview.tsx et les overlays qui affichent un aperçu de sujet.
import { Text } from 'ink';

export function PrettyLines({ text, dimColor = false }: { text: string; dimColor?: boolean }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <Text key={i} dimColor={dimColor} wrap="truncate-end">
          {line.length === 0 ? ' ' : line}
        </Text>
      ))}
    </>
  );
}
