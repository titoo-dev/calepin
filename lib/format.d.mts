// Déclaration de types pour format.mjs, à l'usage exclusif de src-ui/ (tsc
// --noEmit — voir docs/adr/0004). Fichier .d.mts pur : zéro effet runtime,
// Node ne le charge jamais. Le cœur .mjs n'est pas modifié.
//
// ponytail: TS ne résout PAS les `declare module` à chemin relatif écrits
// ailleurs (limitation documentée, testé empiriquement) — un .d.mts
// co-localisé au .mjs est la seule façon correcte de le typer sans y toucher.
// Types minimaux sur les fonctions réellement utilisées par src-ui/, `any`
// ailleurs si besoin plus tard.

export interface TopicObj {
  title: string;
  keywords: string[];
  created: string;
  updated: string;
  decisions: string[];
  reasons: string[];
  facts: string[];
  rules: string[];
  files: string[];
  links: string[];
  narration: string;
}

export function renderPretty(obj: Partial<TopicObj>): string;
export function parseTopic(html: string): TopicObj;
export function serializeTopic(obj: Partial<TopicObj>): string;
