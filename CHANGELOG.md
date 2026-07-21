# Changelog


## 0.2.0 — 2026-07-21

- **TUI** (`calepin ui`) : menu interactif (clack + ink) — parcourir les sujets (filtre, rendu pretty, suppression), recherche hybride avec citation copiable, revue dream candidat par candidat avec application guidée, gestion des espaces (bind/sync/création), formulaire nouveau sujet avec aperçu.
- **Onboarding interactif** : `calepin onboard` sur TTY devient un flow guidé skippable ; comportement non-TTY inchangé.
- Cœur .mjs strictement intact (ADR 0004) : mêmes commandes, même JSON — les agents ne voient aucune différence.
- Typecheck TS (`tsc --noEmit`) branché dans prepublishOnly ; types .d.mts co-localisés sur lib/.

## 0.1.0 — 2026-07-21

Première version publiable.

- **Cœur** : format `<cal-*>` (parseur strict, un élément par ligne), espaces équipe (`.calepin/` in-repo) + perso (`~/.calepin/`, `bind`), `record` (validation + refus de secrets), `query` (JSON, `should_cite`, `citation_block`), `read [--pretty]`, `remove`.
- **Retrieval** : hybride BM25 pondéré par champ + embeddings e5-small locaux (préfixes E5, cache par hash de contenu), fusion RRF, fallback BM25 jamais bloquant, cache des vecteurs de query.
- **Daemon** : `calepin serve` (socket Unix, embedder chaud — query ×20 plus rapide), idempotent, `--stop`.
- **Entretien** : `dream` 4 modes (merge/link/prune/synthesize — propose seulement), compteurs de hits, `cache gc`.
- **Équipe/multi-machines** : espace équipe porté par le repo du projet ; `sync` git des espaces perso.
- **Skill agent** : `skills/calepin/` (cycle query/record, vocabulaire, troubleshooting), hook SessionStart documenté.
- **Qualité** : 64 tests offline, harnais d'éval retrieval + dream, benchmark 3 systèmes (`BENCHMARK.md`).
