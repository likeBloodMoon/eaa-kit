import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  clean: true,
  // Package is ESM-only, so plain .js keeps the published paths readable.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  // Statement templates ship as-is; German legal copy never gets inlined into
  // TypeScript (see CLAUDE.md working agreements).
  copy: [{ from: 'src/statement/templates', to: 'dist/statement' }],
})
