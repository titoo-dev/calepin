// dream — consolidation de la mémoire SUR PROPOSITION (voir PRD §7 F4).
// Ne modifie jamais rien : sortie = candidats + score + raison, l'agent
// applique via record/suppression, l'humain valide (en équipe : via PR).
//
// Similarité entre deux sujets : cosinus des embeddings (déjà en cache, voir
// lib/embed.mjs) quand disponible, sinon Jaccard sur les tokens (voir
// lib/search.mjs::tokenize). En mode embeddings, le Jaccard reste calculé et
// sert de signal secondaire dans la raison affichée.

import { cosine } from './embed.mjs';
import { tokenize } from './search.mjs';

// Seuils calibrés sur eval/fixtures-dream (voir eval/run-dream.mjs).
// Échelle e5 (multilingual-e5-small) : le cosinus entre sujets d'un même
// corpus vit ~0.7-0.95 (voir docs/adr/0003) — les bornes ci-dessous sont
// rondes et se lisent dans cette échelle.
export const MERGE_MIN = 0.93; // quasi-doublons : mêmes faits, à peine reformulés
export const LINK_MIN = 0.85; // zone [LINK_MIN, MERGE_MIN) : sujets proches, pas des doublons
export const SYNTHESIZE_MIN = 0.87; // seuil d'arête pour un cluster (< MERGE_MIN)
// Score composite (voir pruneCandidates) — pas une échelle de similarité.
export const PRUNE_MIN = 0.5;

function topicKey(t) {
  return `${t.space}/${t.path}`;
}

function topicTokens(obj) {
  return tokenize(
    [
      obj.title ?? '',
      (obj.keywords ?? []).join(' '),
      ...(obj.decisions ?? []),
      ...(obj.rules ?? []),
      ...(obj.facts ?? []),
      ...(obj.reasons ?? []),
      obj.narration ?? '',
    ].join(' ')
  );
}

function jaccard(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function keywordOverlapPct(a, b) {
  const j = jaccard(tokenize((a.obj.keywords ?? []).join(' ')), tokenize((b.obj.keywords ?? []).join(' ')));
  return Math.round(j * 100);
}

/** { score, method: 'cosine'|'jaccard', jaccard } — cosine si les deux vecteurs existent. */
function similarity(a, b, topicVectors) {
  const vecA = topicVectors?.get(topicKey(a));
  const vecB = topicVectors?.get(topicKey(b));
  const jac = jaccard(topicTokens(a.obj), topicTokens(b.obj));
  if (vecA && vecB) {
    return { score: cosine(vecA, vecB), method: 'cosine', jaccard: jac };
  }
  return { score: jac, method: 'jaccard', jaccard: jac };
}

function linked(a, b) {
  const linksA = a.obj.links ?? [];
  const linksB = b.obj.links ?? [];
  return linksA.includes(b.path) || linksB.includes(a.path);
}

function pairs(topics) {
  const out = [];
  for (let i = 0; i < topics.length; i++) {
    for (let j = i + 1; j < topics.length; j++) {
      out.push([topics[i], topics[j]]);
    }
  }
  return out;
}

function mergeReason(sim, a, b) {
  const kw = keywordOverlapPct(a, b);
  if (sim.method === 'cosine') {
    return `cosinus ${sim.score.toFixed(2)}, jaccard tokens ${sim.jaccard.toFixed(2)}, mêmes keywords à ${kw}%`;
  }
  return `jaccard ${sim.score.toFixed(2)} sur les tokens (embeddings indisponibles), mêmes keywords à ${kw}%`;
}

function linkReason(sim) {
  if (sim.method === 'cosine') {
    return `cosinus ${sim.score.toFixed(2)}, jaccard tokens ${sim.jaccard.toFixed(2)}, sujets proches sans cal-link`;
  }
  return `jaccard ${sim.score.toFixed(2)} sur les tokens (embeddings indisponibles), sujets proches sans cal-link`;
}

function mergeCandidates(topics, topicVectors, minScore, limit) {
  return pairs(topics)
    .map(([a, b]) => ({ a, b, sim: similarity(a, b, topicVectors) }))
    .filter((p) => p.sim.score >= minScore)
    .map((p) => ({
      paths: [topicKey(p.a), topicKey(p.b)],
      score: p.sim.score,
      reason: mergeReason(p.sim, p.a, p.b),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

function linkCandidates(topics, topicVectors, linkMin, mergeMin, limit) {
  return pairs(topics)
    .map(([a, b]) => ({ a, b, sim: similarity(a, b, topicVectors) }))
    .filter((p) => p.sim.score >= linkMin && p.sim.score < mergeMin && !linked(p.a, p.b))
    .map((p) => ({
      paths: [topicKey(p.a), topicKey(p.b)],
      score: p.sim.score,
      reason: linkReason(p.sim),
    }))
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

function typedElementCount(obj) {
  return (
    (obj.decisions?.length ?? 0) +
    (obj.reasons?.length ?? 0) +
    (obj.facts?.length ?? 0) +
    (obj.rules?.length ?? 0) +
    (obj.files?.length ?? 0)
  );
}

function hasIncomingLink(topic, topics) {
  return topics.some((t) => t !== topic && (t.obj.links ?? []).includes(topic.path));
}

function daysSince(dateStr, todayStr) {
  const d = new Date(dateStr);
  const today = new Date(todayStr);
  if (Number.isNaN(d.getTime()) || Number.isNaN(today.getTime())) return 0;
  return Math.max(0, Math.round((today - d) / 86400000));
}

// Score composite (pas une similarité) : 0 hit query, peu d'éléments, pas de
// cal-link entrant sont des signaux forts (poids égaux) ; l'ancienneté est un
// signal faible et relatif au reste du corpus — si tous les sujets datent du
// même jour, elle ne disqualifie ni ne favorise personne (ponytail: dataset
// trop petit ou trop récent pour dire quoi que ce soit de l'âge en absolu).
function pruneCandidates(topics, hits, minScore, limit) {
  const today = new Date().toISOString().slice(0, 10);
  const ages = topics.map((t) => daysSince(t.obj.updated, today));
  const minAge = Math.min(...ages);
  const maxAge = Math.max(...ages);

  const scored = topics.map((t, i) => {
    const hitCount = hits[topicKey(t)]?.count ?? 0;
    const elements = typedElementCount(t.obj);
    const incoming = hasIncomingLink(t, topics);
    const ageNorm = maxAge === minAge ? 0 : (ages[i] - minAge) / (maxAge - minAge);

    const reasons = [];
    let score = 0;
    if (hitCount === 0) {
      score += 0.4;
      reasons.push('0 hit query');
    }
    if (elements < 2) {
      score += 0.3;
      reasons.push(elements <= 1 ? `${elements} seul élément` : `${elements} éléments seulement`);
    }
    if (!incoming) {
      score += 0.2;
      reasons.push('jamais lié');
    }
    score += 0.1 * ageNorm;
    if (ageNorm >= 0.5) {
      reasons.push(`mis à jour il y a ${ages[i]} jours`);
    }

    return {
      paths: [topicKey(t)],
      score,
      reason: reasons.length > 0 ? reasons.join(', ') : 'aucun signal de mort, gardé par défaut',
    };
  });

  return scored
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function namespaceOf(topicPath) {
  const idx = topicPath.indexOf('/');
  return idx === -1 ? topicPath : topicPath.slice(0, idx);
}

// Clustering glouton simple : union-find sur les arêtes >= seuil, à
// l'intérieur d'un même namespace seulement (synthesize regroupe des sujets
// voisins d'un même thème, pas des sujets similaires au hasard).
function synthesizeCandidates(topics, topicVectors, minScore, limit) {
  const byNamespace = new Map();
  for (const t of topics) {
    const ns = namespaceOf(t.path);
    if (!byNamespace.has(ns)) byNamespace.set(ns, []);
    byNamespace.get(ns).push(t);
  }

  const candidates = [];
  for (const [ns, group] of byNamespace) {
    if (group.length < 3) continue;

    const parent = group.map((_, i) => i);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    const pairScores = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const sim = similarity(group[i], group[j], topicVectors);
        pairScores.push({ i, j, score: sim.score });
        if (sim.score >= minScore) union(i, j);
      }
    }

    const clusters = new Map();
    for (let i = 0; i < group.length; i++) {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(i);
    }

    for (const members of clusters.values()) {
      if (members.length < 3) continue;
      const memberSet = new Set(members);
      const pairwise = pairScores.filter((p) => memberSet.has(p.i) && memberSet.has(p.j));
      const avg = pairwise.reduce((s, p) => s + p.score, 0) / pairwise.length;
      candidates.push({
        paths: members.map((i) => topicKey(group[i])),
        score: avg,
        reason: `cluster de ${members.length} sujets namespace ${ns}/, similarité pairwise moyenne ${avg.toFixed(2)}`,
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * dream(topics, opts) -> { mode, candidates: [{paths, score, reason}] }
 * topics: [{space, path, obj}]. opts: { mode, minScore, limit, topicVectors, hits }.
 * Propose seulement — ne touche jamais au disque.
 */
export function dream(topics, { mode, minScore, limit = 10, topicVectors = null, hits = {} } = {}) {
  switch (mode) {
    case 'merge':
      return { mode, candidates: mergeCandidates(topics, topicVectors, minScore ?? MERGE_MIN, limit) };
    case 'link':
      return { mode, candidates: linkCandidates(topics, topicVectors, minScore ?? LINK_MIN, MERGE_MIN, limit) };
    case 'prune':
      return { mode, candidates: pruneCandidates(topics, hits, minScore ?? PRUNE_MIN, limit) };
    case 'synthesize':
      return { mode, candidates: synthesizeCandidates(topics, topicVectors, minScore ?? SYNTHESIZE_MIN, limit) };
    default:
      throw new Error(`dream: mode inconnu "${mode}" (merge|link|prune|synthesize)`);
  }
}
