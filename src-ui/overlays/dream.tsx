// Overlay `:dream <mode>` : spinner pendant l'analyse, puis revue candidat par
// candidat DANS l'overlay (voir docs/adr/0004 + PRD §7 F4). Remplace l'ancien
// écran clack dream.tsx (mort). JAMAIS d'application sans confirmation
// explicite par candidat, même contrat que le cœur.
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { renderPretty } from '../../lib/format.mjs';
import {
  runDreamAnalysis,
  readTopicByKey,
  mergePlan,
  applyMerge,
  applyLink,
  applyPrune,
  dreamApplyKind,
} from '../../lib/ui-logic.mjs';
import type { DreamMode, DreamCandidate, Topic } from '../../lib/ui-logic.mjs';
import { PrettyLines } from '../pretty-lines.js';
import { OverlayFrame } from './overlay-frame.js';
import { NewTopicOverlay } from './new-topic.js';

type Phase = 'loading' | 'empty' | 'review' | 'confirm' | 'create';
type PendingApply = { kind: 'merge'; keep: Topic; drop: Topic } | { kind: 'prune'; key: string };

export function DreamOverlay({
  cwd,
  mode,
  onClose,
  screenWidth,
  screenHeight,
}: {
  cwd: string;
  mode: DreamMode;
  onClose: (mutated: boolean) => void;
  screenWidth: number;
  screenHeight: number;
}) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [candidates, setCandidates] = useState<DreamCandidate[]>([]);
  const [index, setIndex] = useState(0);
  const [mutated, setMutated] = useState(false);
  const [pending, setPending] = useState<PendingApply | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    void runDreamAnalysis({ cwd, mode }).then((result) => {
      if (cancelled) return;
      setCandidates(result.candidates);
      setPhase(result.candidates.length === 0 ? 'empty' : 'review');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function advance() {
    if (index + 1 >= candidates.length) {
      onClose(mutated);
      return;
    }
    setIndex((i) => i + 1);
    setPhase('review');
    setPending(null);
    setNote('');
  }

  function apply(candidate: DreamCandidate) {
    switch (dreamApplyKind(mode) as DreamMode) {
      case 'merge': {
        const [t1, t2] = candidate.paths.map((k) => readTopicByKey(cwd, k));
        if (!t1 || !t2) {
          setNote('sujet(s) introuvable(s) — candidat ignoré');
          return advance();
        }
        const { keep, drop } = mergePlan(t1, t2);
        setPending({ kind: 'merge', keep, drop });
        setPhase('confirm');
        return;
      }
      case 'link':
        applyLink(cwd, candidate.paths);
        setMutated(true);
        return advance();
      case 'prune':
        setPending({ kind: 'prune', key: candidate.paths[0] });
        setPhase('confirm');
        return;
      case 'synthesize':
        setPhase('create');
        return;
    }
  }

  useInput((input, key) => {
    if (phase === 'loading') return;

    if (phase === 'empty') {
      if (input === 'q' || key.escape || key.return) onClose(mutated);
      return;
    }

    if (phase === 'confirm') {
      if (input === 'y' || input === 'Y') {
        if (pending?.kind === 'merge') applyMerge(cwd, `${pending.drop.space}/${pending.drop.path}`);
        if (pending?.kind === 'prune') applyPrune(cwd, pending.key);
        setMutated(true);
        return advance();
      }
      if (input === 'n' || input === 'N' || key.escape) return advance();
      return;
    }

    if (phase === 'review') {
      if (input === 'a') return apply(candidates[index]);
      if (input === 'i') return advance();
      if (input === 'q' || key.escape) return onClose(mutated);
    }
  }, { isActive: phase !== 'create' });

  if (phase === 'create') {
    const paths = candidates[index]?.paths ?? [];
    const topics = paths.map((k) => readTopicByKey(cwd, k)).filter((t): t is Topic => t != null);
    const presetKeywords = [...new Set(topics.flatMap((t) => t.obj.keywords ?? []))];
    return (
      <NewTopicOverlay
        cwd={cwd}
        presetKeywords={presetKeywords}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        onClose={(saved) => {
          if (saved) setMutated(true);
          advance();
        }}
      />
    );
  }

  const candidate = candidates[index];
  const topics = new Map(candidate?.paths.map((key) => [key, readTopicByKey(cwd, key)]) ?? []);

  return (
    <OverlayFrame title={`dream ${mode}`} screenWidth={screenWidth} screenHeight={screenHeight} color="magenta">
      {phase === 'loading' && <Text dimColor>analyse en cours…</Text>}
      {phase === 'empty' && <Text dimColor>aucun candidat pour ce mode — esc/q pour fermer</Text>}
      {phase === 'confirm' && pending?.kind === 'merge' && (
        <Box flexDirection="column">
          <Text bold>à garder : {pending.keep.space}/{pending.keep.path}</Text>
          <Text bold color="red">
            perdu si confirmé : {pending.drop.space}/{pending.drop.path}
          </Text>
          <PrettyLines text={renderPretty(pending.drop.obj)} dimColor />
          <Text color="yellow">supprimer "{pending.drop.space}/{pending.drop.path}" ? (y/n)</Text>
        </Box>
      )}
      {phase === 'confirm' && pending?.kind === 'prune' && (
        <Text color="yellow">supprimer "{pending.key}" ? (y/n)</Text>
      )}
      {phase === 'review' && candidate && (
        <Box flexDirection="column" flexGrow={1}>
          <Text bold>
            candidat {index + 1}/{candidates.length} — score {candidate.score.toFixed(2)}
          </Text>
          <Text dimColor wrap="truncate-end">
            {candidate.reason}
          </Text>
          <Box flexDirection="row" flexGrow={1} marginTop={1}>
            {candidate.paths.map((key) => {
              const t = topics.get(key);
              return (
                <Box
                  key={key}
                  flexDirection="column"
                  width={Math.floor(screenWidth * 0.7) / candidate.paths.length}
                  marginRight={1}
                  borderStyle="round"
                  borderColor="gray"
                  paddingX={1}
                >
                  <Text color="cyan" wrap="truncate-end">
                    {key}
                  </Text>
                  {t ? <PrettyLines text={renderPretty(t.obj)} /> : <Text color="red">introuvable</Text>}
                </Box>
              );
            })}
          </Box>
          {note && <Text dimColor>{note}</Text>}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {phase === 'review' ? '[a]ppliquer · [i]gnorer · [q]uitter la revue' : ''}
        </Text>
      </Box>
    </OverlayFrame>
  );
}
