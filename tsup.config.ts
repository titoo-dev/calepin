import { defineConfig } from 'tsup';

// Le cœur .mjs n'est jamais bundlé (voir docs/adr/0004) : src-ui/ importe
// lib/*.mjs en relatif, tsup les laisse tels quels (external).
export default defineConfig({
  entry: { ui: 'src-ui/index.tsx' },
  format: 'esm',
  target: 'node20',
  external: [/^\.\.\/lib\//],
  minify: false,
  sourcemap: false,
  clean: true,
});
