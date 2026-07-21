// Déclaration de types pour sync.mjs, à l'usage exclusif de src-ui/ (voir
// lib/format.d.mts pour le pourquoi de ce fichier).

export function listPersonalSpaceNames(): string[];
export function syncSpace(name: string): { ok: boolean; message: string };
