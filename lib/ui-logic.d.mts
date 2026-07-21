// Déclaration de types pour ui-logic.mjs, à l'usage exclusif de src-ui/ (voir
// lib/format.d.mts pour le pourquoi de ce fichier).

import type { TopicObj } from './format.mjs';

export interface Topic {
  space: string;
  path: string;
  obj: TopicObj;
  raw: string;
}

export interface Hit {
  space: string;
  path: string;
  title: string;
  score: number;
  snippet: string;
  bm25?: number;
  cosine?: number;
}

export interface QueryResult {
  hits: Hit[];
  query: string;
  should_cite: boolean;
  citation_block: string;
  mode: string;
  served: boolean;
}

export interface DreamCandidate {
  paths: string[];
  score: number;
  reason: string;
}

export interface DreamResult {
  mode: string;
  candidates: DreamCandidate[];
}

export type RecordFields = {
  topicPath: string;
  title: string;
  keywords?: string[];
  decisions?: string[];
  reasons?: string[];
  facts?: string[];
  rules?: string[];
  files?: string[];
  links?: string[];
  narration?: string;
  spaceLabel?: 'equipe' | 'perso' | null;
};

export function todayISO(): string;
export function scanSecrets(text: string): string | null;
export function loadTopics(cwd: string, spaceLabel?: string | null): Topic[];
export function groupByNamespace(topics: Topic[]): { namespace: string; items: Topic[] }[];
export function filterTopics(topics: Topic[], query: string): Topic[];
export function mergePlan(a: Topic, b: Topic): { keep: Topic; drop: Topic };
export function dreamApplyKind(mode: string): 'merge' | 'link' | 'prune' | 'synthesize';
export function splitTopicKey(key: string): { space: string; path: string };
export function readTopicByKey(cwd: string, key: string): Topic | null;
export function queryMemory(opts: {
  cwd: string;
  question: string;
  limit?: number;
  space?: string | null;
  noEmbed?: boolean;
}): Promise<QueryResult>;
export function runDreamAnalysis(opts: {
  cwd: string;
  mode: string;
  minScore?: number;
  limit?: number;
  space?: string | null;
  noEmbed?: boolean;
}): Promise<DreamResult>;
export function applyMerge(cwd: string, dropKey: string): boolean;
export function applyLink(cwd: string, paths: string[]): void;
export function applyPrune(cwd: string, key: string): boolean;
export function recordTopic(cwd: string, fields: RecordFields): { file: string; space: string };

// ---------------------------------------------------------------------------
// App plein écran `calepin ui` (state/reducer/traduction touches — voir
// docs/adr/0004). Ces types ne sont utilisés que par src-ui/.

export type DreamMode = 'merge' | 'link' | 'prune' | 'synthesize';
export const DREAM_MODES: DreamMode[];

export type Group = { namespace: string; items: Topic[] };

/** Forme minimale des touches ink (voir Key exporté par 'ink'). */
export type KeyLike = {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  ctrl: boolean;
  shift: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  [extra: string]: unknown;
};

export type PendingKey = { key: string; at: number } | null;
export type ConfirmState = { message: string; action: EffectRequest } | null;
export type Message = { kind: 'info' | 'error'; text: string } | null;

export type Overlay =
  | { type: 'help' }
  | { type: 'new' }
  | { type: 'spaces' }
  | { type: 'dream'; mode: DreamMode };

export type EffectRequest =
  | { type: 'QUIT' }
  | { type: 'RUN_QUERY'; question: string }
  | { type: 'BIND'; name: string }
  | { type: 'SYNC'; name: string | null }
  | { type: 'REMOVE_KEY'; key: string }
  | { type: 'COPY_PATH' }
  | { type: 'COPY_CITATION' }
  | { type: 'RELOAD' };

export interface UIState {
  cwd: string;
  topics: Topic[];
  mode: 'NORMAL' | 'SEARCH' | 'COMMAND';
  cmdline: string;
  query: string;
  searchPhase: 'typing' | 'results' | null;
  searchResults: Hit[] | null;
  citationBlock: string;
  cursor: number;
  focus: 'list' | 'preview';
  previewScroll: number;
  fullscreen: boolean;
  overlay: Overlay | null;
  message: Message;
  pendingKey: PendingKey;
  commandHistory: string[];
  historyIndex: number | null;
  confirm: ConfirmState;
  pendingEffect: EffectRequest | null;
  busy: boolean;
}

export type UIAction =
  | { type: 'TOPICS_LOADED'; topics: Topic[] }
  | { type: 'SET_FOCUS'; focus: 'list' | 'preview' }
  | { type: 'MOVE_CURSOR'; delta: number }
  | { type: 'JUMP_TOP' }
  | { type: 'JUMP_BOTTOM' }
  | { type: 'JUMP_NAMESPACE'; direction: 1 | -1 }
  | { type: 'HALF_PAGE'; direction: 1 | -1; viewportRows?: number }
  | { type: 'SET_PENDING_KEY'; pending: PendingKey }
  | { type: 'ENTER_FULLSCREEN' }
  | { type: 'EXIT_FULLSCREEN' }
  | { type: 'PREVIEW_SCROLL'; delta: number }
  | { type: 'ENTER_SEARCH' }
  | { type: 'ENTER_COMMAND' }
  | { type: 'CMDLINE_INPUT'; char: string }
  | { type: 'CMDLINE_BACKSPACE' }
  | { type: 'CMDLINE_CANCEL' }
  | { type: 'CMDLINE_TAB' }
  | { type: 'CMDLINE_HISTORY'; direction: 1 | -1 }
  | { type: 'CMDLINE_SUBMIT' }
  | { type: 'REQUEST_DELETE' }
  | { type: 'REQUEST_QUIT' }
  | { type: 'COPY_PATH' }
  | { type: 'COPY_CITATION' }
  | { type: 'RELOAD' }
  | { type: 'CONFIRM_YES' }
  | { type: 'CONFIRM_NO' }
  | { type: 'OPEN_OVERLAY'; overlay: Overlay['type'] }
  | { type: 'CLOSE_OVERLAY' }
  | { type: 'SET_MESSAGE'; message: Message }
  | { type: 'EFFECT_RESULT'; patch?: Partial<UIState> };

export interface ViewState {
  resultsMode: boolean;
  groups: Group[];
  flat: Topic[];
  hits: Hit[];
  length: number;
  current: Topic | Hit | null;
}

export function clampCursor(cursor: number, length: number): number;
export function moveCursor(cursor: number, length: number, delta: number): number;
export function namespaceStarts(groups: Group[]): number[];
export function jumpNamespace(groups: Group[], cursor: number, direction: 1 | -1): number;
export function halfPageSize(viewportRows: number): number;
export function trackDoubleKey(
  pending: PendingKey,
  key: string,
  now: number,
  timeoutMs?: number
): { pending: PendingKey; triggered: boolean };
export function visibleList(topics: Topic[], query: string): { groups: Group[]; flat: Topic[] };
export const COMMAND_NAMES: string[];
export function parseCommandLine(line: string): { name: string; arg: string };
export function completeCommandName(prefix: string): string;
export function createInitialState(cwd: string): UIState;
export function deriveView(state: UIState): ViewState;
export function keyToAction(state: UIState, input: string, key: KeyLike, now: number): UIAction | null;
export function uiReducer(state: UIState, action: UIAction): UIState;
