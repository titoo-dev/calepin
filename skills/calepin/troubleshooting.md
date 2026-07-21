# Troubleshooting calepin

## `calepin: command not found`
CLI pas sur le PATH. Depuis le repo calepin : `npm link` (une fois), ou appeler directement `node <racine du repo calepin>/calepin.mjs <commande>`.

## `record: aucun espace actif`
Ni `.calepin/` dans le repo (ou un parent), ni espace perso bindé sur ce dossier.
- Mémoire d'équipe : `mkdir -p .calepin/topics` à la racine du repo.
- Mémoire perso : `calepin bind <nom>`.

## `embeddings indisponibles (...), fallback BM25`
Non bloquant — la recherche marche en lexical seul, moins bonne en cross-langue.
- Premier run : le modèle (~110 Mo) se télécharge dans `~/.calepin/cache/models/` ; il faut du réseau une fois. Relancer ensuite : plus besoin de réseau.
- `CALEPIN_NO_EMBED` défini ou `--no-embed` passé : fallback volontaire, rien à corriger.
- Paquet manquant : `npm install` dans le repo calepin.

## `secret détecté (motif: ...) — record refusé`
Le contenu ressemble à une clé/token/mot de passe. Reformuler SANS la valeur (décrire où vit le secret, jamais le secret : « clé dans Doppler, projet X » et non la clé elle-même).

## `format invalide` / `balise cal-* inconnue`
Seules balises admises dans le corps : `cal-decision`, `cal-reason`, `cal-fact`, `cal-rule`, `cal-file`, `cal-link`, plus `<p>` de narration. Une balise par ligne, pas d'imbrication. Ne pas fournir le `<cal-topic>` englobant — le CLI l'ajoute (title/keywords viennent des flags).

## `chemin de sujet invalide`
Format attendu : `categorie/slug` en minuscules-chiffres-tirets (`architecture/choix-orm`). Pas de majuscules, d'espaces, d'accents ni de `..`.

## Query renvoie 0 hit sur un sujet qui existe
Vérifier `calepin current` (les bons espaces sont-ils actifs depuis ce cwd ?). Termes trop exotiques → réessayer avec les mots du titre/keywords. En mode `bm25` (fallback), le cross-langue ne marche pas : utiliser les mots de la langue du sujet.

## `sync: "<dossier>" n'est pas un dépôt git`
L'espace perso n'a jamais été initialisé en dépôt git. Suivre exactement les deux commandes affichées (`git init` puis `git remote add origin <url>`) dans ce dossier — calepin ne le fait jamais à ta place.

## `dream: --mode requis parmi merge|link|prune|synthesize`
Flag `--mode` manquant ou mal orthographié. Un seul mode par appel.
