# Politique de sécurité

## Versions supportées

| Version | Supportée |
|---|---|
| 0.1.x | ✅ |

## Signaler une vulnérabilité

**Ne pas ouvrir d'issue publique.** Utiliser le signalement privé GitHub :
[Security → Report a vulnerability](https://github.com/titoo-dev/calepin/security/advisories/new).

Réponse visée sous 7 jours. Merci d'inclure : version, scénario de reproduction, impact estimé.

## Périmètre

Sont notamment considérés comme vulnérabilités :
- contournement du refus de secrets au `record` ;
- écriture/lecture hors des espaces attendus (traversée de chemin malgré la validation) ;
- exécution de code via un fichier sujet `<cal-*>` forgé ;
- élévation via le socket du daemon `serve`.

Hors périmètre : qualité du retrieval, déni de service local par corpus géant.
