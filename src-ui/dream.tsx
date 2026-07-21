// Écran 3 du menu principal : consolider (dream) — voir docs/adr/0004 et PRD §7 F4.
// JAMAIS d'application sans confirmation explicite par candidat (clack), même
// contrat que le cœur : dream ne modifie rien tout seul.
import { Box, Text, render, useInput } from 'ink';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { renderPretty } from '../lib/format.mjs';
import {
  runDreamAnalysis,
  readTopicByKey,
  mergePlan,
  applyMerge,
  applyLink,
  applyPrune,
  dreamApplyKind,
} from '../lib/ui-logic.mjs';
import { orAbort } from './ui.js';
import { newTopicForm } from './new-topic.js';

type DreamMode = 'merge' | 'link' | 'prune' | 'synthesize';
type Candidate = { paths: string[]; score: number; reason: string };
type Decision = 'apply' | 'ignore' | 'quit';

function PrettyLines({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </>
  );
}

function CandidateApp({
  candidate,
  index,
  total,
  topics,
  onDecision,
}: {
  candidate: Candidate;
  index: number;
  total: number;
  topics: Map<string, ReturnType<typeof readTopicByKey>>;
  onDecision: (d: Decision) => void;
}) {
  useInput((input) => {
    if (input === 'a') onDecision('apply');
    else if (input === 'i') onDecision('ignore');
    else if (input === 'q') onDecision('quit');
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text bold>
        candidat {index + 1}/{total} — score {candidate.score.toFixed(2)}
      </Text>
      <Text dimColor wrap="truncate-end">
        {candidate.reason}
      </Text>
      {candidate.paths.map((key) => {
        const t = topics.get(key);
        return (
          <Box key={key} flexDirection="column" marginTop={1}>
            <Text color="cyan">
              {key}
              {t ? ` — ${t.obj.title}` : pc.red(' (introuvable)')}
            </Text>
            {t && <PrettyLines text={renderPretty(t.obj)} />}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor>[a]ppliquer · [i]gnorer · [q]uitter la revue</Text>
      </Box>
    </Box>
  );
}

async function reviewCandidate(
  cwd: string,
  candidate: Candidate,
  index: number,
  total: number
): Promise<Decision> {
  const topics = new Map(candidate.paths.map((key) => [key, readTopicByKey(cwd, key)]));
  return new Promise<Decision>((resolve) => {
    const app = render(
      <CandidateApp
        candidate={candidate}
        index={index}
        total={total}
        topics={topics}
        onDecision={(d) => {
          app.unmount();
          resolve(d);
        }}
      />,
      { exitOnCtrlC: false }
    );
  });
}

async function applyMergeCandidate(cwd: string, candidate: Candidate): Promise<void> {
  const [t1, t2] = candidate.paths.map((k) => readTopicByKey(cwd, k));
  if (!t1 || !t2) {
    p.log.warn('sujet(s) introuvable(s) — candidat ignoré');
    return;
  }
  const { keep, drop } = mergePlan(t1, t2);
  p.note(renderPretty(keep.obj), `à garder : ${keep.space}/${keep.path}`);
  p.note(renderPretty(drop.obj), `perdu si confirmé : ${drop.space}/${drop.path}`);
  const confirmed = orAbort(
    await p.confirm({ message: `supprimer "${drop.space}/${drop.path}" ?`, initialValue: false })
  );
  if (confirmed) {
    applyMerge(cwd, `${drop.space}/${drop.path}`);
    p.log.success(`fusionné : ${drop.space}/${drop.path} supprimé`);
  }
}

async function applyLinkCandidate(cwd: string, candidate: Candidate): Promise<void> {
  const confirmed = orAbort(
    await p.confirm({ message: 'ajouter un cal-link réciproque entre ces 2 sujets ?', initialValue: true })
  );
  if (confirmed) {
    applyLink(cwd, candidate.paths);
    p.log.success('cal-link ajouté dans les 2 sens');
  }
}

async function applyPruneCandidate(cwd: string, candidate: Candidate): Promise<void> {
  const key = candidate.paths[0];
  const confirmed = orAbort(await p.confirm({ message: `supprimer "${key}" ?`, initialValue: false }));
  if (confirmed) {
    applyPrune(cwd, key);
    p.log.success(`supprimé : ${key}`);
  }
}

async function applySynthesizeCandidate(cwd: string, candidate: Candidate): Promise<void> {
  const topics = candidate.paths.map((k) => readTopicByKey(cwd, k)).filter((t) => t != null);
  p.note(topics.map((t) => `${t!.space}/${t!.path} — ${t!.obj.title}`).join('\n'), 'cluster');

  const go = orAbort(await p.confirm({ message: 'créer un sujet de synthèse pour ce cluster ?', initialValue: true }));
  if (!go) return;

  const keywords = [...new Set(topics.flatMap((t) => t!.obj.keywords ?? []))];
  const created = await newTopicForm(cwd, { presetKeywords: keywords });
  if (!created) return;

  const removeOld = orAbort(
    await p.confirm({ message: 'supprimer maintenant les sujets absorbés par cette synthèse ?', initialValue: false })
  );
  if (removeOld) {
    for (const key of candidate.paths) applyPrune(cwd, key);
    p.log.success(`${candidate.paths.length} sujet(s) absorbé(s) supprimé(s)`);
  }
}

async function applyCandidate(cwd: string, mode: DreamMode, candidate: Candidate): Promise<void> {
  switch (dreamApplyKind(mode) as DreamMode) {
    case 'merge':
      return applyMergeCandidate(cwd, candidate);
    case 'link':
      return applyLinkCandidate(cwd, candidate);
    case 'prune':
      return applyPruneCandidate(cwd, candidate);
    case 'synthesize':
      return applySynthesizeCandidate(cwd, candidate);
  }
}

export async function runDreamScreen(cwd: string): Promise<void> {
  const mode = orAbort(
    await p.select({
      message: 'mode de consolidation',
      options: [
        { value: 'merge', label: 'merge', hint: 'quasi-doublons à fusionner' },
        { value: 'link', label: 'link', hint: 'sujets proches à relier' },
        { value: 'prune', label: 'prune', hint: 'sujets probablement morts' },
        { value: 'synthesize', label: 'synthesize', hint: 'clusters à regrouper' },
      ],
    })
  ) as DreamMode;

  const s = p.spinner();
  s.start('analyse en cours…');
  const result = await runDreamAnalysis({ cwd, mode });
  s.stop(`${result.candidates.length} candidat(s)`);

  if (result.candidates.length === 0) {
    p.log.info('aucun candidat pour ce mode');
    return;
  }

  for (let i = 0; i < result.candidates.length; i++) {
    const decision = await reviewCandidate(cwd, result.candidates[i], i, result.candidates.length);
    if (decision === 'quit') return;
    if (decision === 'ignore') continue;
    await applyCandidate(cwd, mode, result.candidates[i]);
  }
  p.log.success('revue terminée');
}
