# BENCHMARK — retrieval calepin

Date : 2026-07-21
Corpus : eval/fixtures-dream/ (60 sujets) + eval/fixtures-bench-en/ (20 sujets) — 80 sujets. fixtures-dream/ : 58 sujets rédigés en français (vocabulaire technique anglais mêlé, normal en fr technique), 1 sujet intégralement en anglais (`architecture/database-sharding`) et son doublon volontaire en français (`architecture/postgres-sharding-workspace`, prévu pour le test dream `merge`, pas pour ce bench). fixtures-bench-en/ : 20 sujets intégralement en anglais (title, keywords monolingues, contenu), même projet fictif (workspace de messagerie), ajoutés pour donner au cross-langue un vrai volume à mesurer.
Questions : eval/questions-bench.json — 50 questions, écrites avant lecture des scores.

## Rappel / précision (50 questions, top-5)

| Système | recall@1 | recall@3 | MRR@5 |
|---|---|---|---|
| baseline-grep | 46% | 56% | 0.50 |
| bm25 (`--no-embed`) | 54% | 70% | 0.62 |
| hybrid (bm25+e5+rrf) | 60% | 76% | 0.68 |

## Rappel / précision par bucket linguistique (top-5)

`requete→sujet` : `fr→fr` questions françaises sur sujet français, `en→fr` questions anglaises sur sujet français, `fr→en` questions françaises sur sujet anglais (cross-langue pur, sans pont keywords bilingue), `en→en` questions anglaises sur sujet anglais (monolingue en), `fourre-tout` requêtes keyword-soup sans marqueur de langue net (voir détection dans bench.mjs).

| Bucket | n | grep r@1 | bm25 r@1 | hybrid r@1 | grep r@3 | bm25 r@3 | hybrid r@3 |
|---|---|---|---|---|---|---|---|
| fr→fr | 10 | 70% | 100% | 100% | 90% | 100% | 100% |
| en→fr | 14 | 21% | 29% | 50% | 43% | 64% | 79% |
| fr→en | 12 | 0% | 0% | 0% | 0% | 25% | 33% |
| en→en | 8 | 100% | 100% | 100% | 100% | 100% | 100% |
| fourre-tout | 6 | 83% | 83% | 83% | 83% | 83% | 83% |

## Latence par query (ms)

| Système / condition | p50 | p95 | n |
|---|---|---|---|
| baseline-grep — in-process | 0 ms | 1 ms | 50 |
| baseline-grep — spawn froid (indicatif) | 34 ms | — | 5 |
| bm25 — in-process | 2 ms | 3 ms | 50 |
| bm25 — spawn froid (indicatif) | 60 ms | — | 5 |
| hybrid — in-process chaud | 7 ms | 11 ms | 50 |
| hybrid — spawn froid (`node calepin.mjs query` réel) | 1069 ms | 1157 ms | 50 |

## Empreinte

| Mesure | Valeur |
|---|---|
| Taille node_modules | 686M |
| Cache modèle (`~/.calepin/cache/models`) | 130M |
| Dépendances directes (package.json) | 1 |

## Limites (honnêteté du bench)

- **Byterover réel non mesurable** : produit cloud fermé, ce bench ne le compare pas — `bm25` est un *proxy* de son approche déclarée (retrieval lexical structuré, zéro LLM, champs indexés séparément), pas Byterover lui-même.
- **Corpus synthétique** écrit par un agent (fixtures-dream/ + fixtures-bench-en/), pas un vrai projet — structure et style peuvent favoriser un retrieval structuré par champs (`<cal-*>`) plus qu'un vrai repo hétérogène.
- **Questions écrites par le même agent** que celui qui a conçu et lit ce corpus — biais de familiarité possible malgré la contrainte de paraphrase et l'écriture avant lecture des scores.
- **Détection de bucket approximative** : la classification fr/en du bucket linguistique repose sur une liste de mots-outils (voir `detectQueryLang` dans bench.mjs), pas un vrai détecteur de langue — les requêtes keyword-soup sans marqueur net tombent volontairement dans `fourre-tout` plutôt que d'être forcées dans un bucket fr/en arbitraire.
- **should_cite non mesuré ici** : ce bench mesure recall/MRR/latence/empreinte, pas les faux positifs de citation (voir `eval/run.mjs` pour ça).
- **Résultat fr→en inattendu, rapporté tel quel** : sur les 12 questions du bucket, recall@1 nul pour les 3 systèmes (grep, bm25, hybrid) — l'écart hybrid vs bm25 attendu n'apparaît qu'au recall@3 (25% bm25 vs 33% hybrid). Vérifié hors bug : sur un échantillon de ces questions, le rang cosinus e5 du sujet attendu dépassait 60/80 — le modèle `multilingual-e5-small` ne comble pas systématiquement l'écart cross-langue sur des sujets aussi courts, malgré la vocation multilingue du modèle.

