// Espaces (équipe/perso), bindings, lecture/écriture des sujets sur disque.
// Voir docs/adr/0001 pour le choix de stockage hybride.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serializeTopic } from './format.mjs';

const TOPIC_PATH_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;

export function home() {
  return process.env.CALEPIN_HOME || path.join(os.homedir(), '.calepin');
}

/** Valide un chemin de sujet ("categorie/slug"). Jette si invalide. */
export function validateTopicPath(topicPath) {
  if (!TOPIC_PATH_RE.test(topicPath)) {
    throw new Error(
      `chemin de sujet invalide: "${topicPath}" (attendu: minuscules/chiffres/tirets, segments séparés par /)`
    );
  }
}

/** Remonte depuis cwd jusqu'à la racine FS, cherche un dossier .calepin/. */
export function findTeamRoot(cwd) {
  let dir = path.resolve(cwd);
  const fsRoot = path.parse(dir).root;
  while (true) {
    if (fs.existsSync(path.join(dir, '.calepin'))) {
      return dir;
    }
    if (dir === fsRoot) return null;
    dir = path.dirname(dir);
  }
}

function bindingsFile() {
  return path.join(home(), 'bindings.json');
}

function loadBindings() {
  try {
    return JSON.parse(fs.readFileSync(bindingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function saveBindings(bindings) {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(bindingsFile(), JSON.stringify(bindings, null, 2) + '\n');
}

/** Lie cwd à l'espace perso <name>. Crée l'espace (dossier) si absent. */
export function bind(cwd, name) {
  const bindings = loadBindings();
  bindings[path.resolve(cwd)] = name;
  saveBindings(bindings);
  fs.mkdirSync(path.join(home(), 'spaces', name, 'topics'), { recursive: true });
}

/** Résout l'espace perso bindé pour cwd : préfixe le plus long. */
function resolvePersonalSpaceName(cwd) {
  const resolved = path.resolve(cwd);
  const bindings = loadBindings();
  let best = null;
  for (const [boundPath, name] of Object.entries(bindings)) {
    if (resolved === boundPath || resolved.startsWith(boundPath + path.sep)) {
      if (best === null || boundPath.length > best.path.length) {
        best = { path: boundPath, name };
      }
    }
  }
  return best?.name ?? null;
}

/** [{label, root}] — équipe d'abord si présente. root = dossier contenant topics/. */
export function activeSpaces(cwd) {
  const spaces = [];
  const teamRoot = findTeamRoot(cwd);
  if (teamRoot) {
    spaces.push({ label: 'equipe', root: path.join(teamRoot, '.calepin') });
  }
  const personalName = resolvePersonalSpaceName(cwd);
  if (personalName) {
    spaces.push({ label: `perso:${personalName}`, root: path.join(home(), 'spaces', personalName) });
  }
  return spaces;
}

function topicsDir(space) {
  return path.join(space.root, 'topics');
}

function topicFile(space, topicPath) {
  return path.join(topicsDir(space), `${topicPath}.html`);
}

/** [{space, path, file}] pour tous les .html sous space/topics/. */
export function listTopics(space) {
  const dir = topicsDir(space);
  const results = [];
  const walk = (current, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const slug = entry.name.slice(0, -'.html'.length);
        const topicPath = prefix ? `${prefix}/${slug}` : slug;
        results.push({ space: space.label, path: topicPath, file: full });
      }
    }
  };
  walk(dir, '');
  return results;
}

/** Lit le contenu brut d'un sujet (string HTML), ou null si absent. */
export function readTopic(space, topicPath) {
  validateTopicPath(topicPath);
  try {
    return fs.readFileSync(topicFile(space, topicPath), 'utf8');
  } catch {
    return null;
  }
}

/** Sérialise obj et écrit le fichier du sujet (crée les dossiers nécessaires). */
export function writeTopic(space, topicPath, obj) {
  validateTopicPath(topicPath);
  const file = topicFile(space, topicPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeTopic(obj));
  return file;
}

/**
 * Supprime le fichier du sujet + les dossiers devenus vides sous topics/
 * (symétrique de writeTopic). -> true si supprimé, false si absent.
 */
export function removeTopic(space, topicPath) {
  validateTopicPath(topicPath);
  const file = topicFile(space, topicPath);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);

  const stopAt = topicsDir(space);
  let dir = path.dirname(file);
  while (dir !== stopAt && dir.startsWith(stopAt + path.sep) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
  return true;
}
