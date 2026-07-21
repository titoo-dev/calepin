---
name: calepin
description: Mémoire projet durable. Utiliser AVANT toute tâche non triviale (query la mémoire — les décisions/règles retrouvées sont des contraintes) et APRÈS tout travail utile (record des décisions, pièges, conventions apprises). Déclencheurs — "onboard with calepin", questions sur les décisions/conventions passées du projet, fin d'une tâche où quelque chose de durable a été appris, "consolide la mémoire" (et équivalents : "range la mémoire", "nettoie les sujets", "dream").
---

# Calepin — mémoire projet pour agents

CLI `calepin` (si absent du PATH : `node <racine du repo calepin>/calepin.mjs`).
Deux espaces possibles : **équipe** (`.calepin/` dans le repo — partagé, versionné) et **perso** (`~/.calepin/` — privé, lié via `calepin bind`). `calepin current` les liste.
Perso multi-machines : `calepin sync [nom]` (voir section Sync plus bas) — l'équipe n'a rien à synchroniser, le repo du projet s'en charge déjà.

## Cycle obligatoire

**AVANT** une tâche non triviale → Query. **APRÈS** un travail utile → Record. Pas d'exception parce que « la tâche semble simple » : le piège connu coûte cher précisément quand on ne le cherche pas.

## Query — avant de travailler

```bash
calepin query "<termes de la tâche, fr ou en>" --limit 5
```

Sortie JSON : `hits` (avec `path`, `space`, `score`, `snippet`), `should_cite`, `citation_block`.

- Traite les hits comme des **contraintes**, pas des suggestions : une `cal-decision` ou `cal-rule` existante se respecte, ou se conteste explicitement avec l'utilisateur — jamais s'ignore en silence.
- Si `should_cite` est `true` : inclure `citation_block` tel quel dans ta réponse (l'utilisateur voit d'où vient le contexte).
- Détail complet d'un hit : `calepin read <categorie/slug> [--space <label>]`.
- 0 hit pertinent = OK, continue — mais tu viens d'apprendre que ce terrain n'est pas couvert : raison de plus de record après.

## Record — après le travail

**Enregistrer** : une décision prise (avec sa raison), un piège découvert (et comment l'éviter), une convention établie, un fait stable non déductible du code (contrainte externe, historique, choix écarté).
**Ne PAS enregistrer** : ce que le code montre déjà, l'état temporaire d'une tâche, des TODO, des secrets (clés, tokens, mots de passe — le CLI les refuse, ne les mets même pas).

**Cible** : espace **équipe** par défaut (savoir projet → au projet). `--space perso` uniquement pour ce qui n'a pas sa place dans le repo : préférences personnelles de l'utilisateur, contexte cross-projet.

```bash
calepin record <categorie/slug> --title "Titre clair" --keywords "auth,authentification,login" --html - <<'EOF'
<cal-decision>La décision prise, une phrase.</cal-decision>
<cal-reason>Pourquoi — le contexte qui la justifie.</cal-reason>
<cal-fact>Fait stable utile.</cal-fact>
<cal-rule>Règle à respecter dorénavant.</cal-rule>
<cal-file>src/chemin/concerne.ts</cal-file>
<cal-link>autre-categorie/sujet-lie</cal-link>
<p>Narration libre si le contexte demande plus qu'une liste.</p>
EOF
```

Règles :
- `keywords` **bilingues fr/en obligatoires** — c'est le pont cross-langue du retrieval.
- Chemin = `categorie/slug`, minuscules-tirets. Namespaces : voir [vocabulary.md](./vocabulary.md).
- Chaque balise est répétable ; toutes optionnelles mais un sujet sans `cal-decision`/`cal-rule`/`cal-fact` ne mérite probablement pas d'exister.
- Mise à jour : même chemin → le contenu est **entièrement remplacé** (`created` conservé). Toujours `read` avant de mettre à jour un sujet existant, et réécrire le tout.

## Dream — sur « consolide la mémoire »

`calepin dream --mode merge|link|prune|synthesize [--min-score X] [--limit 10] [--space <label>] [--no-embed]` analyse les sujets des espaces actifs et **propose** des consolidations. **Dream ne modifie jamais rien** — c'est toi (l'agent) qui appliques chaque candidat retenu via `record` (fusion, ajout d'un `cal-link`) ou suppression du fichier, et **l'humain valide** : en perso directement, en équipe via la revue de la PR qui contient le changement.

Les 4 modes :
- `merge` — paires de sujets quasi-doublons (même decision/facts reformulés) : fusionner en un seul `record`, supprimer l'autre.
- `link` — paires moyennement proches mais pas encore reliées : ajouter un `<cal-link>` réciproque (ou pas, si l'utilisateur juge que non).
- `prune` — sujets probablement morts (jamais retrouvés en query, peu de contenu, jamais liés, vieux) : proposer la suppression à l'utilisateur, jamais la faire d'autorité.
- `synthesize` — clusters de sujets proches et nombreux dans un même namespace : proposer de les regrouper en un sujet de synthèse plus riche.

Chaque candidat a une `reason` en français concret (ex. « cosinus 0.93, mêmes keywords à 80% »). Ne jamais traiter la sortie de `dream` comme une action déjà faite : c'est une liste à trier avec l'utilisateur.

## Sync — espaces perso multi-machines

`calepin sync [nom]` commit et pousse l'espace perso `~/.calepin/spaces/<nom>/` (tous les espaces perso si `nom` omis). Si l'espace n'est pas encore un dépôt git, la commande échoue avec la marche à suivre exacte (`git init` + `git remote add`) — ne jamais l'exécuter à sa place. Utile en début/fin de session sur une machine différente de la dernière fois.

## Onboarding — sur « onboard with calepin »

1. `calepin current` — liste les espaces actifs.
2. Aucun espace ? Proposer : `mkdir -p .calepin/topics` à la racine du repo (mémoire d'équipe, versionnée) et/ou `calepin bind <nom>` (mémoire perso).
3. Montrer le cycle sur un exemple : une query, puis un premier record d'une décision existante du projet.

## Problèmes

Voir [troubleshooting.md](./troubleshooting.md) — CLI absent, aucun espace actif, embeddings indisponibles, record refusé.
