# BENCHMARK — retrieval calepin

Date : 2026-07-21
Corpus : eval/fixtures-dream/ — 60 sujets. Langues réelles : 58 sujets rédigés en français (vocabulaire technique anglais mêlé, normal en fr technique), 1 sujet intégralement en anglais (`architecture/database-sharding`) et son doublon volontaire en français (`architecture/postgres-sharding-workspace`, prévu pour le test dream `merge`, pas pour ce bench).
Questions : eval/questions-bench.json — 30 questions, écrites avant lecture des scores.

## Rappel / précision (30 questions, top-5)

| Système | recall@1 | recall@3 | MRR@5 |
|---|---|---|---|
| baseline-grep | 60% | 77% | 0.68 |
| bm25 (`--no-embed`) | 73% | 93% | 0.83 |
| hybrid (bm25+e5+rrf) | 80% | 93% | 0.88 |

## Latence par query (ms)

| Système / condition | p50 | p95 | n |
|---|---|---|---|
| baseline-grep — in-process | 0 ms | 0 ms | 30 |
| baseline-grep — spawn froid (indicatif) | 33 ms | — | 5 |
| bm25 — in-process | 1 ms | 2 ms | 30 |
| bm25 — spawn froid (indicatif) | 53 ms | — | 5 |
| hybrid — in-process chaud | 7 ms | 15 ms | 30 |
| hybrid — spawn froid (`node calepin.mjs query` réel) | 1077 ms | 1177 ms | 30 |

## Empreinte

| Mesure | Valeur |
|---|---|
| Taille node_modules | 686M |
| Cache modèle (`~/.calepin/cache/models`) | 130M |
| Dépendances directes (package.json) | 1 |

## Limites (honnêteté du bench)

- **Byterover réel non mesurable** : produit cloud fermé, ce bench ne le compare pas — `bm25` est un *proxy* de son approche déclarée (retrieval lexical structuré, zéro LLM, champs indexés séparément), pas Byterover lui-même.
- **Corpus synthétique** écrit par un agent (fixtures-dream/), pas un vrai projet — structure et style peuvent favoriser un retrieval structuré par champs (`<cal-*>`) plus qu'un vrai repo hétérogène.
- **Questions écrites par le même agent** que celui qui a conçu et lit ce corpus — biais de familiarité possible malgré la contrainte de paraphrase et l'écriture avant lecture des scores.
- **Corpus très majoritairement français** : le lot "cross-langue" et "anglais sur sujet anglais" repose presque entièrement sur un seul sujet réellement anglais (`architecture/database-sharding`) — la proportion cible du brief (~8 questions "en/en") n'était pas atteignable telle quelle vu le corpus réel ; les questions ont été redistribuées vers "anglais → sujet français" (bucket bien couvert par le corpus) plutôt que dupliquées artificiellement sur la même cible.
- **should_cite non mesuré ici** : ce bench mesure recall/MRR/latence/empreinte, pas les faux positifs de citation (voir `eval/run.mjs` pour ça).

