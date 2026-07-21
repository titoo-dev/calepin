// App plein écran `calepin ui` (voir docs/adr/0004) : buffer alternatif façon
// vim, layout persistant (liste 40% / preview 60%, barre de statut, ligne de
// commande), modes NORMAL/SEARCH/COMMAND, overlays centrés. Remplace le menu
// clack qui enchaînait des écrans séparés (menu.tsx, browse.tsx, search.tsx,
// dream.tsx, spaces.ts, new-topic.ts — tous supprimés sauf onboard.ts).
import { useEffect, useReducer } from 'react';
import { Box, Text, render, useApp, useInput, useWindowSize } from 'ink';
import * as store from '../lib/store.mjs';
import * as sync from '../lib/sync.mjs';
import {
  createInitialState,
  uiReducer,
  keyToAction,
  deriveView,
  loadTopics,
  queryMemory,
  applyPrune,
  clampCursor,
  visibleList,
} from '../lib/ui-logic.mjs';
import type { EffectRequest, Topic, UIState } from '../lib/ui-logic.mjs';
import { copyToClipboard } from './ui.js';
import { TopicList } from './list.js';
import { Preview } from './preview.js';
import { StatusBar } from './statusbar.js';
import { CmdLine } from './cmdline.js';
import { HelpOverlay } from './overlays/help.js';
import { SpacesOverlay } from './overlays/spaces.js';
import { NewTopicOverlay } from './overlays/new-topic.js';
import { DreamOverlay } from './overlays/dream.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';

function summarizeSpaces(topics: Topic[]): string {
  const counts = new Map<string, number>();
  for (const t of topics) counts.set(t.space, (counts.get(t.space) ?? 0) + 1);
  return [...counts.entries()].map(([label, n]) => `${label} (${n})`).join(' · ');
}

async function runEffect(
  effect: EffectRequest,
  state: UIState,
  resolve: (patch: Partial<UIState>) => void,
  exit: () => void
): Promise<void> {
  switch (effect.type) {
    case 'QUIT':
      exit();
      return;

    case 'RUN_QUERY': {
      const result = await queryMemory({ cwd: state.cwd, question: effect.question });
      resolve({
        searchPhase: 'results',
        searchResults: result.hits,
        citationBlock: result.citation_block,
        cursor: 0,
        message: {
          kind: 'info',
          text: `${result.hits.length} résultat(s) — mode ${result.mode}${result.served ? ' (serve)' : ''}`,
        },
      });
      return;
    }

    case 'BIND': {
      store.bind(state.cwd, effect.name);
      resolve({ topics: loadTopics(state.cwd), message: { kind: 'info', text: `espace perso "${effect.name}" lié` } });
      return;
    }

    case 'SYNC': {
      const names = effect.name ? [effect.name] : sync.listPersonalSpaceNames();
      if (names.length === 0) {
        resolve({ message: { kind: 'error', text: 'sync: aucun espace perso à synchroniser' } });
        return;
      }
      const messages = names.map((n) => sync.syncSpace(n).message);
      resolve({ message: { kind: 'info', text: messages.join(' | ') } });
      return;
    }

    case 'REMOVE_KEY': {
      const removed = applyPrune(state.cwd, effect.key);
      const topics = loadTopics(state.cwd);
      resolve({
        topics,
        cursor: clampCursor(state.cursor, visibleList(topics, '').flat.length),
        message: removed
          ? { kind: 'info', text: `supprimé : ${effect.key}` }
          : { kind: 'error', text: `introuvable : ${effect.key}` },
      });
      return;
    }

    case 'COPY_PATH': {
      const view = deriveView(state);
      if (!view.current) {
        resolve({ message: { kind: 'error', text: 'rien à copier' } });
        return;
      }
      const item = view.current as { space: string; path: string };
      const key = `${item.space}/${item.path}`;
      copyToClipboard(key);
      resolve({ message: { kind: 'info', text: `chemin copié (OSC52) : ${key}` } });
      return;
    }

    case 'COPY_CITATION': {
      if (!state.citationBlock) {
        resolve({ message: { kind: 'info', text: 'rien à citer (should_cite=false)' } });
        return;
      }
      copyToClipboard(state.citationBlock);
      resolve({ message: { kind: 'info', text: 'citation_block copié (OSC52)' } });
      return;
    }

    case 'RELOAD':
      resolve({ topics: loadTopics(state.cwd), message: { kind: 'info', text: 'corpus rechargé' } });
      return;
  }
}

function App({ cwd }: { cwd: string }) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(uiReducer, cwd, createInitialState);
  const { columns, rows } = useWindowSize();

  useEffect(() => {
    dispatch({ type: 'TOPICS_LOADED', topics: loadTopics(cwd) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!state.pendingEffect) return;
    let cancelled = false;
    void runEffect(
      state.pendingEffect,
      state,
      (patch) => {
        if (!cancelled) dispatch({ type: 'EFFECT_RESULT', patch });
      },
      exit
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingEffect]);

  const bodyHeight = Math.max(3, rows - 3); // header + statusbar + cmdline
  const listWidth = Math.max(20, Math.floor(columns * 0.4));
  const previewWidth = Math.max(20, columns - listWidth);
  const view = deriveView(state);

  useInput(
    (input, key) => {
      const action = keyToAction(state, input, key, Date.now());
      if (!action) return;
      if (action.type === 'HALF_PAGE') {
        dispatch({ ...action, viewportRows: bodyHeight - 2 });
        return;
      }
      dispatch(action);
    },
    { isActive: state.overlay === null }
  );

  return (
    <Box flexDirection="column" width={columns} height={rows} position="relative">
      <Box>
        <Text>
          <Text bold color="cyan">
            calepin
          </Text>
          <Text dimColor> — {summarizeSpaces(state.topics) || 'aucun espace actif'}</Text>
        </Text>
      </Box>

      {state.fullscreen ? (
        <Preview cwd={cwd} view={view} focused scroll={state.previewScroll} width={columns} height={bodyHeight} />
      ) : (
        <Box flexDirection="row" height={bodyHeight}>
          <TopicList view={view} cursor={state.cursor} focused={state.focus === 'list'} width={listWidth} height={bodyHeight} />
          <Preview
            cwd={cwd}
            view={view}
            focused={state.focus === 'preview'}
            scroll={state.previewScroll}
            width={previewWidth}
            height={bodyHeight}
          />
        </Box>
      )}

      <StatusBar state={state} view={view} width={columns} />
      <CmdLine state={state} width={columns} />

      {state.overlay?.type === 'help' && (
        <HelpOverlay screenWidth={columns} screenHeight={rows} onClose={() => dispatch({ type: 'CLOSE_OVERLAY' })} />
      )}

      {state.overlay?.type === 'spaces' && (
        <SpacesOverlay
          cwd={cwd}
          screenWidth={columns}
          screenHeight={rows}
          onClose={(reload) => {
            dispatch({ type: 'CLOSE_OVERLAY' });
            if (reload) dispatch({ type: 'TOPICS_LOADED', topics: loadTopics(cwd) });
          }}
        />
      )}

      {state.overlay?.type === 'new' && (
        <NewTopicOverlay
          cwd={cwd}
          screenWidth={columns}
          screenHeight={rows}
          onClose={(saved) => {
            dispatch({ type: 'CLOSE_OVERLAY' });
            if (saved) {
              dispatch({ type: 'TOPICS_LOADED', topics: loadTopics(cwd) });
              dispatch({ type: 'SET_MESSAGE', message: { kind: 'info', text: 'sujet enregistré' } });
            }
          }}
        />
      )}

      {state.overlay?.type === 'dream' && (
        <DreamOverlay
          cwd={cwd}
          mode={state.overlay.mode}
          screenWidth={columns}
          screenHeight={rows}
          onClose={(mutated) => {
            dispatch({ type: 'CLOSE_OVERLAY' });
            if (mutated) dispatch({ type: 'TOPICS_LOADED', topics: loadTopics(cwd) });
          }}
        />
      )}
    </Box>
  );
}

/**
 * runUi() — point d'entrée de `calepin ui` (voir docs/adr/0004). Buffer
 * alternatif façon vim : le terminal de l'utilisateur revient intact à la
 * sortie, y compris sur erreur, Ctrl-C ou signal.
 */
export async function runUi(): Promise<void> {
  // Jamais de TUI hors TTY interactif (voir docs/adr/0004) : ink exige le
  // raw mode sur stdin, indisponible sur un pipe/fichier (CI, `| cat`, ...).
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('calepin: terminal non interactif — TUI indisponible ici\n');
    return;
  }

  const cwd = process.cwd();
  process.stdout.write(ENTER_ALT_SCREEN);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    process.stdout.write(EXIT_ALT_SCREEN);
  };
  process.on('exit', restore);
  const onSignal = () => {
    restore();
    process.exit(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const instance = render(<App cwd={cwd} />);
    await instance.waitUntilExit();
  } finally {
    restore();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
