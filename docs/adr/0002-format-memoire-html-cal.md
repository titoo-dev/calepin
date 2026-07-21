# Format mémoire : HTML structuré `<cal-*>`, brut

Un sujet est un fichier HTML structuré avec des balises propres à Calepin (`<cal-topic>`, `<cal-decision>`, `<cal-reason>`, `<cal-fact>`, `<cal-rule>`, `<cal-file>`, `<cal-link>` + narration libre), pas du markdown.

Raisons : parsing robuste (pas de convention de titres de sections à deviner ni de canon de langue à imposer aux agents) et champs indexés séparément sans ambiguïté pour le ranking. Le schéma s'inspire du format `<bv-*>` de Byterover mais les balises portent notre namespace : aucune compatibilité fichier avec Byterover n'est promise ni recherchée.

Coût accepté en connaissance de cause : les records de l'espace équipe passent en PR sous forme de HTML brut, moins lisible que du markdown, et aucun rendu « joli » n'est fourni en v1 (pas de Desktop, pas de `read` avec rendu). Si la lecture humaine devient un vrai point de douleur, un rendu terminal dans `read` est l'upgrade path — le format stocké, lui, ne bouge pas.

## Considered Options

- **Markdown + frontmatter + sections canoniques EN** (recommandation initiale du PRD) : lisible en PR, mais parsing par convention fragile (titres en langue/orthographe libres).
- **Frontmatter YAML entièrement structuré** : parsing trivial mais pénible à écrire pour un agent, illisible en PR.
- **Balises `<bv-*>` telles quelles** : compat théorique avec Byterover, mais signature d'un produit tiers dans nos fichiers pour une migration hypothétique — rejeté au profit du namespace propre.
- **HTML `<cal-*>` (choisi)** : robustesse, namespace à nous, lisibilité sacrifiée.
