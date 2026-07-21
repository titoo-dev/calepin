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
