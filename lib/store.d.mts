// Déclaration de types pour store.mjs, à l'usage exclusif de src-ui/ (voir
// lib/format.d.mts pour le pourquoi de ce fichier).

export interface Space {
  label: string;
  root: string;
}

export function home(): string;
export function activeSpaces(cwd: string): Space[];
export function listTopics(space: Space): { space: string; path: string; file: string }[];
export function readTopic(space: Space, topicPath: string): string | null;
export function writeTopic(space: Space, topicPath: string, obj: any): string;
export function removeTopic(space: Space, topicPath: string): boolean;
export function bind(cwd: string, name: string): void;
export function validateTopicPath(topicPath: string): void;
export function findTeamRoot(cwd: string): string | null;
