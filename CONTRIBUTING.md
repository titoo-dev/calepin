# Contribuer à calepin

Merci ! Règles courtes, projet volontairement minimal.

## Principes

- **Zéro dépendance runtime** hors `@huggingface/transformers` (décision d'architecture, voir `docs/adr/0003`). Une PR qui ajoute une dépendance doit la justifier lourdement.
- **Les scripts n'appellent jamais de LLM ni le réseau** au moment de la query (l'inférence d'embeddings est locale).
- Décisions structurantes documentées dans `docs/adr/` ; vocabulaire dans `CONTEXT.md` ; spec dans `PRD.md`. Lire avant de proposer un changement de fond.
- Style : Node ≥ 20, ESM `.mjs`, code et commentaires en français, sobre. Les shortcuts délibérés portent un commentaire `// ponytail:`.

## Workflow

1. Fork + branche depuis `main`.
2. `npm install` puis `npm test` (offline, rapide) — doit rester vert.
3. Changement de comportement → test qui le couvre. Changement de retrieval → `npm run eval` (et `npm run eval:dream` si dream est touché) doivent rester PASS.
4. PR petite et focalisée, description du pourquoi. Les records `.calepin/` du repo peuvent faire partie de la PR (c'est la mémoire d'équipe du projet — normal).

## Signaler un bug

Issue avec : version (`npm ls -g calepin` ou commit), OS, commande exacte, sortie complète. Pour une faille de sécurité : voir [SECURITY.md](./SECURITY.md), pas d'issue publique.
