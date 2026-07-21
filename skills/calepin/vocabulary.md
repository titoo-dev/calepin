# Vocabulaire calepin

## Balises d'un sujet

| Balise | Contenu | Poids retrieval |
|---|---|---|
| `<cal-decision>` | Décision prise, une phrase | ×2 |
| `<cal-reason>` | Pourquoi cette décision | ×1 |
| `<cal-fact>` | Fait stable, non déductible du code | ×1 |
| `<cal-rule>` | Règle à respecter dorénavant | ×2 |
| `<cal-file>` | Chemin de fichier concerné (relatif au repo) | ×1 |
| `<cal-link>` | Chemin d'un autre sujet lié (`categorie/slug`) | ×1 |
| `<p>` | Narration libre | ×1 |

Attributs du `<cal-topic>` (posés par le CLI, pas à la main) : `title` et `keywords` — poids ×3, les plus déterminants pour le retrieval.

## Namespaces de chemins

| Namespace | Usage |
|---|---|
| `architecture/` | Décisions de structure, choix techniques durables |
| `conventions/` | Règles de code, de nommage, de process |
| `pieges/` | Pièges découverts et comment les éviter |
| `domaine/` | Savoir métier, vocabulaire, invariants du domaine |
| `outils/` | Spécificités d'outils, de config, d'environnement |

Namespace manquant ? En créer un est permis — minuscules-tirets, au singulier ou pluriel naturel. Ne pas sur-découper : 5 namespaces couvrent l'essentiel.

## Espaces

| Label | Où | Quoi |
|---|---|---|
| `equipe` | `.calepin/` à la racine du repo | Savoir projet — partagé via le repo (défaut du record) |
| `perso:<nom>` | `~/.calepin/spaces/<nom>/` | Préférences perso, contexte cross-projet (`--space perso`), synchronisable via `calepin sync` |

## Modes de `dream`

| Mode | Propose |
|---|---|
| `merge` | Paires de sujets quasi-doublons à fusionner en un seul |
| `link` | Paires proches sans `cal-link` entre elles, à relier |
| `prune` | Sujets probablement morts (0 hit, peu de contenu, jamais liés, vieux), à supprimer |
| `synthesize` | Clusters de petits sujets proches dans un même namespace, à regrouper en un sujet de synthèse |
