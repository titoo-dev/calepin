# PRD — Calepin (clone Byterover V4)

> Nom définitif : **calepin** (petit carnet qu'on garde sur soi) — dispo npm vérifiée le 2026-07-21.
> Statut : Draft v2 — 2026-07-21 — révisé après session de grilling (voir `docs/adr/`)

---

## 1. Vision

Donner aux agents de code (Claude Code, Codex CLI, OpenCode…) une **mémoire projet durable** : l'agent interroge la mémoire avant de travailler, enregistre ce qu'il a appris après, et cette connaissance survit aux sessions, aux `/clear` et aux machines.

Réplique du cœur de Byterover V4, en local-first et open source :
**un skill portable + des scripts déterministes sans LLM + un format mémoire structuré et interrogeable.**

## 2. Problème

- Chaque session d'agent repart de zéro : décisions d'architecture, conventions, pièges connus sont re-découverts (ou violés) à chaque fois.
- Les mémoires natives des harnais (CLAUDE.md, mémoire auto) sont soit trop courtes, soit non structurées, soit non partageables entre agents/outils/machines.
- Byterover résout ça mais : propriétaire, cloud obligatoire pour le partage, format et sync non documentés.

## 3. Objectifs / Non-objectifs

### Objectifs (v1)
1. Un agent peut **lier** un dossier projet à son espace perso (`bind`) ; l'espace équipe est découvert automatiquement (`.calepin/` dans le repo).
2. Un agent peut **interroger** la mémoire en langage naturel — tous espaces actifs, ranking fusionné, citations (`query`).
3. Un agent peut **enregistrer** une connaissance structurée — décisions, faits, règles, raisons (`record`).
4. Un agent peut **consolider** la mémoire sur proposition, jamais automatiquement (`dream`).
5. Fonctionne **hors-ligne, sans compte, sans serveur** (mode dégradé sans le modèle d'embeddings).
6. Partage équipe **gratuit via le repo projet** ; sync perso multi-machines via `calepin sync` (git).

### Non-objectifs (v1)
- Pas d'app Desktop, pas de GUI.
- Pas d'auth, pas de comptes, pas de rôles — les permissions équipe = les permissions du repo.
- Pas de backend cloud, pas de sync temps réel.
- Pas d'appel LLM dans les scripts. L'intelligence vit dans le prompt du skill, les scripts sont bêtes et auditables. (L'inférence d'embeddings locale n'est pas un appel LLM.)

## 4. Utilisateurs

| Persona | Besoin |
|---|---|
| Dev solo multi-projets | Mémoire par projet qui survit aux sessions et aux harnais (Claude Code + Codex sur le même projet). |
| Petite équipe | Conventions et décisions partagées via le repo du projet lui-même — zéro infra. |
| Opérateur multi-agents | Plusieurs agents (VPS, local) lisent/écrivent la même mémoire. |

## 5. Architecture

```
┌────────────────────────────┐
│ Agent (Claude Code, …)     │
│  └─ skill calepin           │  SKILL.md : QUAND query/record/dream
│      └─ scripts/*.mjs      │  scripts : COMMENT (zéro LLM, Node 20+)
└──────┬─────────────┬───────┘
       │             │
┌──────▼──────┐ ┌────▼──────────────────┐
│ ~/.calepin/  │ │ <repo projet>/.calepin/│
│ bindings.json│ │  topics/<path>.html  │  ESPACE ÉQUIPE
│ spaces/perso/│ │  (versionné, PR,     │  découvert par présence,
│  topics/…   │ │   permissions = repo)│  jamais bindé
│ cache/index │ └───────────────────────┘
└─────────────┘   ESPACE PERSO
                  privé, cross-projet, sync git via `calepin sync`
```

**Décisions structurantes** (détail + alternatives dans `docs/adr/`) :
- **ADR 0001 — Stockage hybride** : perso hors repo (`~/.calepin/`), équipe dans le repo (`.calepin/`). Query fusionne les deux (source affichée) ; Record cible l'équipe par défaut quand elle existe, le perso sur demande.
- **ADR 0002 — Format `<cal-*>`** : sujets en HTML structuré, balises propres à Calepin (schéma inspiré de Byterover, zéro compat promise), brut (pas de rendu v1). Parsing robuste, champs indexés séparément. Lisibilité PR sacrifiée en connaissance de cause.
- **ADR 0003 — Retrieval hybride** : BM25 maison (exact-match) + embeddings multilingues locaux (transformers.js, modèle quantizé ~50–120 Mo au premier run) pour synonymie et cross-langue fr/en. Fallback BM25 seul si modèle absent.

Index et vecteurs : régénérables, jamais committés (cache local `~/.calepin/cache/`, invalidation par mtime).

## 6. Format mémoire (spec)

Un sujet = un fichier `topics/<categorie>/<slug>.html`, HTML structuré `<cal-*>` :

```html
<cal-topic title="Auth — flux desktop et sync daemon"
          keywords="auth, authentification, daemon, sync, oauth"
          created="2026-07-21" updated="2026-07-21">
  <cal-decision>Refresh token en keychain, jamais sur disque.</cal-decision>
  <cal-reason>Fuite historique via logs (2025-11) ; keychain dispo sur les 3 OS cibles.</cal-reason>
  <cal-fact>Le daemon tourne en user-space, port dynamique.</cal-fact>
  <cal-fact>Refresh toutes les 45 min, jitter ±5 min.</cal-fact>
  <cal-file>src/auth/daemon.ts</cal-file>
  <cal-link>architecture/overview</cal-link>
  <p>Narration libre, dans la langue de l'utilisateur…</p>
</cal-topic>
```

Règles :
- Éléments typés (`cal-decision`, `cal-reason`, `cal-fact`, `cal-rule`, `cal-file`) indexés séparément avec des poids différents (title/keywords ×3, decision/rule ×2, corps ×1).
- `cal-link` = graphe entre sujets (utilisé par `dream --mode link`).
- Chemin hiérarchique = namespace (`architecture/…`, `conventions/…`, `pieges/…`).
- Un élément par ligne (diffs git corrects).
- `record` valide la structure et rejette les balises inconnues.

## 7. Fonctionnalités (v1)

### F1 — `bind` / découverte
- Espace équipe : découvert par présence de `.calepin/` en remontant les dossiers parents. Jamais bindé.
- Espace perso : `calepin bind <space>` enregistre `chemin_absolu → space` dans `~/.calepin/bindings.json`. Aucun fichier écrit dans le projet.
- `calepin current` : affiche les espaces actifs résolus (équipe + perso).

### F2 — `query`
- `calepin query "<question>" [--limit 5] [--space X]`.
- Cherche dans **tous les espaces actifs**, ranking fusionné, chaque hit étiqueté de sa source.
- Score hybride : BM25 pondéré par champ + cosinus embeddings (fusion à calibrer, constante documentée). Fallback BM25 seul sans modèle.
- Sortie JSON : `{ hits: [{path, space, title, score, snippet}], query, should_cite, citation_block }`.
- `calepin read <space>/<path>` : dump du sujet complet (brut).
- Index régénéré si plus vieux que les fichiers (mtime) — pas de démon.

### F3 — `record`
- `calepin record <path> --title T --keywords a,b [--space perso] --html -` (document `<cal-*>` sur stdin).
- Défaut : espace équipe si présent, sinon perso. `--space perso` pour le non-partageable — SKILL.md guide le choix (savoir projet → équipe ; préférences/contexte perso → perso).
- Valide la structure `<cal-*>`, refuse les secrets évidents (regex clés API/tokens/IP privées), met à jour l'index.
- Sujet existant → mise à jour (`updated` retouché), pas de doublon silencieux.

### F4 — `dream`
- `calepin dream --mode merge|link|prune|synthesize [--min-score 0.3] [--limit 10]`.
- Similarité = cosinus sur les embeddings déjà en cache (+ recoupement lexical), âge, taille, compteur de hits query.
- Sortie JSON : candidats + score + raison. **Propose seulement** — l'agent applique via record/suppression, l'humain valide (en équipe : via PR, gratuit).

### F5 — Le skill (`SKILL.md`)
Le composant le plus important. Instructions à l'agent :
- **Avant** toute tâche non triviale : `query` ; hits = contraintes ; citer via `citation_block` si `should_cite`.
- **Après** un travail utile : `record` — quoi enregistrer, quoi ne PAS enregistrer (rien de dérivable du code, pas de secrets), et **où** (équipe vs perso).
- Keywords : toujours bilingues fr/en (renforce le pont cross-langue en plus des embeddings).
- Déclencheurs : « onboard with Calepin » (bind + tour du format), « consolide la mémoire » (dream).
- `vocabulary.md` : types et namespaces. `troubleshooting.md` : erreurs courantes.

### F6 — Sync perso
- `calepin sync` : sur `~/.calepin/spaces/<space>/` — commit auto horodaté + `git pull --rebase` + push (remote privé configuré une fois).
- L'équipe n'a **rien** : le repo projet porte déjà `.calepin/`.

## 8. Stack technique

| Choix | Décision | Raison |
|---|---|---|
| Langage | Node.js ≥ 20, ESM `.mjs` | Même contrainte que Byterover ; dispo partout où tournent les agents. |
| Dépendances | **Une seule** : transformers.js (embeddings) | ADR 0003. Tout le reste natif : fs/path/crypto, parseur `<cal-*>` maison (sous-ensemble strict, pas un parseur HTML général), BM25 maison. |
| Modèle | multilingual-e5-small quantizé (ou équivalent) | Téléchargé au premier run, cache local, offline ensuite. Fallback BM25 sans lui. |
| CLI | Un seul point d'entrée `calepin.mjs` + sous-commandes | `process.argv`, pas de framework CLI. |
| Stockage | Fichiers plats + index/vecteurs en cache local | Diffable, greppable, réparable. Pas de SQLite tant que < ~5 000 sujets. |
| Tests | `node --test` | Natif, zéro framework. |
| Distribution | Repo git avec `skills/calepin/` | `npx skills add`, ou symlink dans `~/.claude/skills/`. |

## 9. Phasage

| Phase | Contenu | Critère de sortie |
|---|---|---|
| **P1 — Cœur** | Format `<cal-*>` + parseur + découverte/`bind` + `record` + `query` BM25 (sans embeddings) + tests | Sur ce repo même : record 10 sujets, query les retrouve, `should_cite` sensé. |
| **P2 — Embeddings** | transformers.js + fusion de scores + fallback + calibration seuil `should_cite` | Query fr retrouve un sujet rédigé en anglais (et inversement) dans le top 3. |
| **P3 — Skill** | `SKILL.md` + `read` + `citation_block` + vocabulary/troubleshooting | Claude Code fait query→code→record sans intervention sur une vraie tâche, cible le bon espace. |
| **P4 — Hygiène + sync** | `dream` (4 modes) + compteurs de hits + `calepin sync` | Sur 50+ sujets, merge/prune pertinents ; perso synchronisé entre 2 machines. |

Backlog (si besoin mesuré) : SQLite+FTS5, TUI de visualisation, rendu joli dans `read`, hooks d'auto-query en début de session.

## 10. Métriques de succès

- **Utile** : sur une session réelle, ≥ 1 hit query cité influence le code produit.
- **Rappel** : sur un jeu de 20 questions rejouées (dont cross-langue), le bon sujet est dans le top 3 ≥ 80 % du temps.
- **Bruit** : `should_cite` faux-positif < 20 %.
- **Friction** : `record` < 5 s ; install skill < 1 min (hors téléchargement du modèle, one-shot en arrière-plan).

## 11. Risques

| Risque | Mitigation |
|---|---|
| L'agent oublie de query/record (le skill ne « prend » pas) | Itérer SKILL.md ; déclencheurs explicites ; en dernier recours hook SessionStart. |
| Record dans le mauvais espace (perso qui fuit en équipe via PR) | Règles SKILL.md explicites + le PR review attrape ce qui passe. |
| Fusion de scores BM25/cosinus mal calibrée | Constantes documentées + jeu de 20 questions rejouables comme harnais de calibration (métrique rappel). |
| Modèle absent/lent sur VPS-CI | Fallback BM25 automatique, jamais bloquant. |
| Mémoire-poubelle | SKILL.md strict sur quoi NE PAS enregistrer + `dream prune`. |
| Secrets enregistrés | Règle SKILL.md + regex de refus au `record` — d'autant plus critique que l'espace équipe part dans le repo. |
| HTML `<cal-*>` illisible en PR | Accepté (ADR 0002). Upgrade path : rendu terminal dans `read`. |

## 12. Questions ouvertes

Aucune. (Calibration des seuils : validée sur eval/ en P2–P4 — `SHOULD_CITE_MIN=1.5`, `COSINE_CITE_MIN=0.85` inchangés ; seuils dream `MERGE=0.93 / LINK=0.85 / SYNTH=0.87 / PRUNE=0.5` calibrés sur eval/fixtures-dream.)
