# Calepin

Mémoire projet durable pour agents de code : les agents interrogent la mémoire avant de travailler, y enregistrent ce qu'ils apprennent après. Clone local-first de Byterover V4.

## Language

**Espace** :
Conteneur de mémoire avec une frontière de partage. Deux sortes : l'espace perso (privé à l'utilisateur, hors des repos) et l'espace équipe (vit dans le repo du projet, partagé avec quiconque a le repo).
_Avoid_ : workspace, base, vault

**Sujet** :
L'unité de mémoire — un fichier, un chemin hiérarchique, une connaissance. Ce que Query retrouve et que Record écrit.
_Avoid_ : mémoire (ambigu), note, document

**Bind** :
Liaison persistante d'un dossier projet vers l'espace perso à utiliser. L'espace équipe, lui, est découvert par sa présence dans le repo — jamais bindé.

**Query** :
Interrogation de la mémoire avant le travail. Cherche dans tous les espaces actifs, ranking fusionné, source affichée.

**Record** :
Enregistrement d'une connaissance après un travail utile. Cible l'espace équipe par défaut quand il existe ; l'espace perso sur demande ou pour le non-partageable.

**Dream** :
Consolidation de la mémoire sur proposition : détecte doublons, sujets à lier, contenu obsolète. Ne modifie jamais rien lui-même.

**Citation** :
Bloc prêt à coller indiquant la source d'un contexte remonté par Query. Émis seulement quand la pertinence dépasse le seuil (`should_cite`).

**Skill** :
Le paquet d'instructions + scripts installé chez l'agent. Les instructions décident QUAND query/record/dream ; les scripts exécutent COMMENT, sans LLM.
