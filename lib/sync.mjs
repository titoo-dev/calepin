// Sync git des espaces PERSO uniquement (voir PRD §7 F6). L'équipe n'a rien
// à synchroniser : le repo du projet porte déjà `.calepin/`.
// spawnSync uniquement, jamais de shell string interpolée.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { home } from './store.mjs';

function git(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function isGitRepo(dir) {
  return git(['rev-parse', '--is-inside-work-tree'], dir).status === 0;
}

function hasRemote(dir) {
  const res = git(['remote'], dir);
  return res.status === 0 && res.stdout.trim().length > 0;
}

function currentBranch(dir) {
  const res = git(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  return res.status === 0 ? res.stdout.trim() : null;
}

function hasChanges(dir) {
  const res = git(['status', '--porcelain'], dir);
  return res.status === 0 && res.stdout.trim().length > 0;
}

function remoteHasBranch(dir, remote, branch) {
  const res = git(['ls-remote', '--heads', remote, branch], dir);
  return res.status === 0 && res.stdout.trim().length > 0;
}

/** Noms des espaces perso existants sous $CALEPIN_HOME/spaces/. */
export function listPersonalSpaceNames() {
  const dir = path.join(home(), 'spaces');
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Sync un espace perso : commit horodaté (skip si rien à committer), puis
 * pull --rebase + push si un remote existe. N'initialise et ne configure
 * JAMAIS git à la place de l'utilisateur.
 * -> { ok: boolean, message: string }
 */
export function syncSpace(name) {
  const dir = path.join(home(), 'spaces', name);
  if (!fs.existsSync(dir)) {
    return { ok: false, message: `sync: espace perso "${name}" introuvable (${dir})` };
  }
  if (!isGitRepo(dir)) {
    return {
      ok: false,
      message:
        `sync: "${dir}" n'est pas un dépôt git — marche à suivre :\n` +
        `  cd ${dir} && git init\n` +
        `  cd ${dir} && git remote add origin <url>`,
    };
  }

  if (hasChanges(dir)) {
    const add = git(['add', '-A'], dir);
    if (add.status !== 0) return { ok: false, message: `sync: git add a échoué (${name}): ${add.stderr}` };
    const commit = git(['commit', '-m', `calepin sync ${new Date().toISOString()}`], dir);
    if (commit.status !== 0) return { ok: false, message: `sync: git commit a échoué (${name}): ${commit.stderr}` };
  }

  if (!hasRemote(dir)) {
    return { ok: true, message: `sync: "${name}" — commit local seul, aucun remote configuré` };
  }

  const branch = currentBranch(dir) ?? 'HEAD';
  if (remoteHasBranch(dir, 'origin', branch)) {
    const pull = git(['pull', '--rebase', 'origin', branch], dir);
    if (pull.status !== 0) {
      return {
        ok: false,
        message: `sync: "${name}" — git pull --rebase a échoué (conflit ?), résoudre dans ${dir}:\n${pull.stderr}`,
      };
    }
  }

  const push = git(['push', 'origin', branch], dir);
  if (push.status !== 0) {
    return { ok: false, message: `sync: "${name}" — git push a échoué:\n${push.stderr}` };
  }
  return { ok: true, message: `sync: "${name}" synchronisé (${branch})` };
}
