// Aides partagées TUI : logo sobre, abandon Ctrl-C propre, presse-papier
// (voir ~/Projects/fluent-tech/ft-cli/src/ui.ts pour les conventions clack
// dont ce fichier s'inspire — abortNow/orAbort notamment).
import pc from 'picocolors';
import * as p from '@clack/prompts';

/** Abandon immédiat et propre (curseur restauré, code 130). */
export function abortNow(): never {
  process.stdout.write('\x1b[?25h');
  console.error(pc.yellow('\ninterrompu'));
  process.exit(130);
}

/** Valeur de prompt clack : Ctrl-C (cancel) = abandon immédiat. */
export function orAbort<T>(value: T | symbol): T {
  if (p.isCancel(value)) abortNow();
  return value as T;
}

/** Logo texte sobre, 2 lignes, aucune dépendance ascii-art. */
export function banner(): string {
  return '\n' + pc.bold(pc.cyan('calepin')) + pc.dim(' — mémoire projet durable pour agents de code') + '\n';
}

/** Résumé des espaces actifs pour l'en-tête du menu principal. */
export function spacesSummary(spaces: { label: string; topics: number }[]): string {
  if (spaces.length === 0) return pc.dim('aucun espace actif — voir "Espaces" dans le menu');
  return spaces.map((s) => `${pc.cyan(s.label)} ${pc.dim(`(${s.topics} sujet${s.topics > 1 ? 's' : ''})`)}`).join(' · ');
}

/**
 * Copie `text` dans le presse-papier via OSC52 (fonctionne dans la plupart
 * des terminaux modernes, y compris via SSH/tmux). On ne peut pas détecter
 * fiablement le support depuis Node : on tente toujours l'écriture ET on
 * affiche le texte, l'utilisateur voit dans tous les cas ce qu'il aurait
 * copié si OSC52 est silencieusement ignoré par le terminal.
 */
export function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}
