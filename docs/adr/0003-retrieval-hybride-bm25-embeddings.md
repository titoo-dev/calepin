# Retrieval hybride : BM25 + embeddings multilingues locaux dès la v1

La mémoire sera bilingue (prose en français, termes techniques/code en anglais) ; le lexical pur ne fait ni synonymie ni cross-langue. Nous adoptons dès la v1 un ranking fusionné : BM25 maison pour l'exact-match (identifiants, chemins, termes techniques) + similarité cosinus d'embeddings multilingues locaux (transformers.js, modèle type multilingual-e5-small quantizé) pour le sens.

Ceci abandonne délibérément le « zéro dépendance runtime » et l'« installation < 1 min » du PRD initial : dépendance d'inférence ONNX + modèle (~50–120 Mo) téléchargé au premier run. Aucun appel LLM ni réseau au moment de la query — l'inférence est locale, le principe zéro-LLM des scripts tient toujours.

Si le modèle est absent (CI, VPS légers, premier run hors-ligne), le ranking retombe sur BM25 seul — dégradé, jamais bloquant.

## Considered Options

- **BM25 + keywords bilingues imposés par le skill** (reco initiale) : zéro dep, mais fait porter la qualité du retrieval sur la discipline de rédaction des agents.
- **Embeddings seuls** : perd l'exact-match, rédhibitoire pour de la mémoire de code.
- **Hybride (choisi)** : les deux signaux, au prix d'une fusion de scores à calibrer.
