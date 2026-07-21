// Daemon local `calepin serve` : charge l'embedder UNE fois et répond aux
// queries via un socket Unix — évite le rechargement du pipeline e5 à chaque
// process (voir BENCHMARK.md : ~1.1s à froid vs ~7ms à chaud).
// Protocole : une ligne JSON par requête -> une ligne JSON réponse.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { home } from './store.mjs';
import { getEmbedder } from './embed.mjs';
import { runQuery } from './query.mjs';

const CLIENT_TIMEOUT_MS = 250;

export function socketPath() {
  return path.join(home(), 'serve.sock');
}

export function pidfilePath() {
  return path.join(home(), 'serve.pid');
}

/** true si un serveur répond déjà sur ce socket (connexion acceptée). */
function pingAlive(sockPath) {
  return new Promise((resolve) => {
    const client = net.createConnection(sockPath);
    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, CLIENT_TIMEOUT_MS);
    client.on('connect', () => {
      clearTimeout(timer);
      client.destroy();
      resolve(true);
    });
    client.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Requête client -> réponse du daemon, ou null si le socket est absent, mort,
 * ou trop lent (timeout court). Jamais d'exception : c'est le contrat du
 * fallback in-process côté calepin.mjs.
 */
export function clientRequest(req) {
  return new Promise((resolve) => {
    const sockPath = socketPath();
    if (!fs.existsSync(sockPath)) return resolve(null);

    let settled = false;
    const client = net.createConnection(sockPath);
    const timer = setTimeout(() => finish(null), CLIENT_TIMEOUT_MS);

    function finish(val) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      resolve(val);
    }

    let buffer = '';
    client.on('connect', () => client.write(JSON.stringify(req) + '\n'));
    client.on('data', (chunk) => {
      buffer += chunk;
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      try {
        finish(JSON.parse(buffer.slice(0, idx)));
      } catch {
        finish(null);
      }
    });
    client.on('error', () => finish(null));
  });
}

async function handleRequest(req) {
  if (req.op !== 'query') return { error: `op inconnue: "${req.op}"` };
  return runQuery({
    cwd: req.cwd,
    question: req.question,
    limit: req.limit ?? 5,
    space: req.space ?? null,
    noEmbed: Boolean(req.noEmbed),
  });
}

/**
 * Démarre le daemon en foreground. Idempotent : si un daemon répond déjà sur
 * ce socket, se contente d'un message stderr et retourne (exit 0) — utile
 * depuis un hook SessionStart qui ne doit jamais empiler de daemons ni
 * échouer. Un socket MORT (fichier présent, connexion refusée) est écrasé.
 * Ne retourne qu'à l'arrêt (SIGINT/SIGTERM) sinon.
 */
export async function startServer() {
  const sockPath = socketPath();
  const pidPath = pidfilePath();

  if (fs.existsSync(sockPath)) {
    if (await pingAlive(sockPath)) {
      process.stderr.write('calepin: serve: daemon déjà actif\n');
      return;
    }
    fs.unlinkSync(sockPath); // socket périmé (process mort sans nettoyer) : on l'écrase
  }

  process.stderr.write("calepin: chargement de l'embedder...\n");
  await getEmbedder(); // peut rester null (fallback BM25) — on démarre quand même.
  process.stderr.write('calepin: embedder prêt\n');

  fs.mkdirSync(path.dirname(sockPath), { recursive: true });

  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', async (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim().length === 0) continue;
        let reply;
        try {
          reply = await handleRequest(JSON.parse(line));
        } catch (err) {
          reply = { error: err.message };
        }
        socket.write(JSON.stringify(reply) + '\n');
      }
    });
    socket.on('error', () => {}); // client parti brutalement : rien à faire côté daemon
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(sockPath, resolve);
  });
  fs.writeFileSync(pidPath, String(process.pid));
  process.stderr.write(`calepin: serve démarré (pid ${process.pid}, socket ${sockPath})\n`);

  await new Promise((resolve) => {
    const cleanup = () => {
      server.close();
      try {
        fs.unlinkSync(sockPath);
      } catch {
        // déjà absent, rien à faire
      }
      try {
        fs.unlinkSync(pidPath);
      } catch {
        // déjà absent, rien à faire
      }
      resolve();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}

/** Lit le pidfile, envoie SIGTERM. Message clair si absent/déjà mort. */
export function stopServer() {
  const pidPath = pidfilePath();
  let pid;
  try {
    pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  } catch {
    return { ok: false, message: 'calepin: serve --stop: aucun daemon actif (pidfile absent)' };
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // rien à nettoyer
    }
    return { ok: false, message: `calepin: serve --stop: daemon déjà arrêté (pid ${pid} introuvable)` };
  }
  return { ok: true, message: `calepin: serve arrêté (pid ${pid})` };
}
