# Couche TUI TypeScript par-dessus le cœur .mjs, jamais à sa place

v2 ajoute une interface interactive de gestion et d'onboarding (`calepin ui`, `calepin onboard` en mode TTY) construite avec la stack ft-cli : TypeScript + tsup vers `dist/`, @clack/prompts pour les flows, ink + react pour les écrans riches (navigation des sujets, revue dream), picocolors.

Le cœur reste intact : scripts `.mjs` sans build, sortie JSON, zéro LLM. Les agents et les scripts continuent d'utiliser exactement le même CLI ; la TUI est une porte d'entrée humaine qui appelle les mêmes fonctions `lib/`. Détection : sous-commande `ui` explicite, ou `onboard` sur un TTY interactif ; jamais de TUI quand stdout n'est pas un TTY.

## Considered Options

- **Réécrire tout le CLI en TS/commander** : uniformité, mais casse « scripts auditables sans build » (les agents exécutent du source, pas un bundle), gros churn pour zéro gain côté agents.
- **Paquet séparé calepin-ui** : cœur pur, mais deux paquets à versionner/installer pour une seule expérience.
- **Couche dans le même paquet (choisi)** : `src-ui/` TS → `dist/ui.js` bundlé, import dynamique depuis calepin.mjs. Un seul `npm i -g`, cœur inchangé.

## Consequences

- Dépendances runtime ajoutées : @clack/prompts, ink, react, picocolors (execa et commander de ft-cli écartés : rien à exécuter d'externe, le parseur d'arguments existe déjà).
- Build (`tsup`) requis pour la TUI ; `dist/` publié dans le paquet npm, jamais committé.
- Si `dist/` manque (clone dev sans build), les commandes TUI affichent la marche à suivre et les commandes cœur fonctionnent normalement.
