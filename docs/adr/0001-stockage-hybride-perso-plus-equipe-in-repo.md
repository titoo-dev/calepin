# Stockage hybride : espace perso hors repo, espace équipe dans le repo

Byterover stocke toute la mémoire hors des projets (spaces cloud + liaison locale). Nous choisissons un hybride : l'espace perso vit sous `~/.calepin/` (privé, cross-projet, jamais dans un repo), l'espace équipe vit directement dans le repo du projet — versionné, partagé et permissionné par le repo lui-même, sans backend ni bind.

Query fusionne les résultats des deux espaces (ranking commun, source affichée). Record écrit dans l'espace équipe par défaut quand il existe — le savoir projet appartient au projet — et dans le perso sur demande explicite ou pour le non-partageable.

## Considered Options

- **Tout hors repo (modèle Byterover)** : split perso/équipe propre, mais exige un mécanisme de sync et de partage à construire (git d'espaces séparés) et un bind pour tout.
- **Tout dans le repo** : zéro bind, zéro sync, mais mémoire perso impossible et bruit dans les PRs pour tout.
- **Hybride (choisi)** : chaque sorte d'espace prend le mécanisme de partage qui lui coûte le moins — le perso reste local, l'équipe hérite du repo.

## Consequences

- La résolution multi-espace (fusion query, choix de cible record) entre dès la v1 — le PRD initial la reportait.
- Les records équipe apparaissent dans les diffs/PRs du projet.
- Pas de commande share/sync à écrire pour l'équipe : le repo du projet s'en charge.
