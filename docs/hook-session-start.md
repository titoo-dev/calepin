# Hook SessionStart — rendre le cycle calepin mécanique

Risque n°1 du PRD : « l'agent oublie de query/record ». Le skill compte sur la
discipline de l'agent ; ce hook rend le début de cycle mécanique — à chaque
nouvelle session Claude Code, l'agent démarre avec l'état des espaces sous les
yeux et le rappel du cycle.

## Installation (Claude Code)

Dans `~/.claude/settings.json` (global) ou `.claude/settings.json` (par projet) :

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "calepin current 2>/dev/null && echo 'calepin actif — query avant toute tâche non triviale, record après tout travail utile (skill calepin)' || true"
          }
        ]
      }
    ]
  }
}
```

Notes :
- `|| true` : si le CLI n'est pas installé sur cette machine, le hook reste silencieux — jamais bloquant.
- La sortie du hook est injectée dans le contexte de session : l'agent voit les espaces actifs (et leur nombre de sujets) sans avoir à y penser.
- Version par projet : ne l'ajouter qu'aux repos qui ont un `.calepin/` — le hook global couvre tout mais imprime une ligne inutile sur les projets sans mémoire.

## Variante avec daemon

Si `calepin serve` est utilisé (queries hybrides rapides), on peut le démarrer
en même temps :

```json
"command": "calepin current 2>/dev/null && (calepin serve >/dev/null 2>&1 &) ; echo 'calepin actif — query avant, record après' || true"
```

Le daemon est idempotent (socket déjà pris = il sort) ; le `&` le détache du hook.
