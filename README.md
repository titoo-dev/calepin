# calepin

Mémoire projet durable pour agents de code. L'agent **query** la mémoire avant de travailler, **record** ce qu'il a appris après — et cette connaissance survit aux sessions, aux `/clear`, aux machines et aux harnais (Claude Code, Codex CLI, OpenCode…).

Local-first, sans compte, sans serveur. Une seule dépendance.

```bash
npm install -g calepin
calepin onboard          # crée la mémoire d'équipe (.calepin/) dans le repo
```

## Le cycle

```bash
# avant une tâche — les hits sont des contraintes, pas des suggestions
calepin query "conventions d'authentification" --limit 5

# après un travail utile
calepin record architecture/choix-auth --title "Auth par passkeys" \
  --keywords "auth,authentification,passkey,webauthn" --html - <<'EOF'
<cal-decision>Passkeys par défaut, pas de mots de passe.</cal-decision>
<cal-reason>Zéro secret à stocker ; support natif des 3 plateformes cibles.</cal-reason>
<cal-file>src/auth/passkey.ts</cal-file>
EOF
```

Sortie de `query` : JSON avec hits scorés, `should_cite` et un `citation_block` prêt à coller — l'utilisateur voit d'où vient le contexte.

## Deux espaces

| Espace | Où | Partage |
|---|---|---|
| **équipe** | `.calepin/` à la racine du repo | via le repo lui-même — versionné, PR, permissions git. Cible par défaut de `record`. |
| **perso** | `~/.calepin/spaces/<nom>/` (`calepin bind <nom>`) | privé ; multi-machines via `calepin sync` (git). |

`query` fusionne les deux. Pas de backend, pas de compte : le repo du projet **est** l'infra de partage.

## Retrieval hybride

BM25 pondéré par champ (exact-match : identifiants, chemins) + embeddings multilingues locaux (e5-small, ~130 Mo téléchargés au premier run) fusionnés par RRF. Mémoire bilingue fr/en comprise — une query française retrouve un sujet rédigé en anglais. Modèle absent ou `--no-embed` → fallback BM25 pur, jamais bloquant.

Queries lentes en CLI (rechargement du modèle à chaque process) ? Lancez le daemon :

```bash
calepin serve &          # embedder chaud : ~1 s → ~50 ms par query (×20)
```

## Entretien de la mémoire

```bash
calepin dream --mode merge|link|prune|synthesize   # propose des consolidations — ne modifie jamais rien
calepin remove <categorie/slug>                    # applique une suppression décidée
calepin cache gc                                   # purge vecteurs vieux + hits orphelins
```

## Skill agent

`skills/calepin/SKILL.md` apprend le cycle aux agents (Claude Code & compatibles) : query avant, record après, quoi enregistrer, quoi ne pas enregistrer (les secrets sont refusés au `record`), quel espace cibler. Hook SessionStart optionnel : `docs/hook-session-start.md`.

## Toutes les commandes

`bind` · `current` · `record` · `query` · `read [--pretty]` · `remove` · `dream` · `sync` · `serve [--stop]` · `cache gc` · `onboard` — détail : `calepin --help`.

## Développement

```bash
npm test          # 64 tests, offline
npm run eval      # harnais retrieval (rappel, should_cite)
npm run eval:dream
npm run bench     # benchmark 3 systèmes — voir BENCHMARK.md
```

Décisions d'architecture : `docs/adr/`. Glossaire : `CONTEXT.md`. Spec produit : `PRD.md`.

## Licence

MIT
