import { defineConfig } from 'tsdown'

export default defineConfig({
  // The audit worker is a third entry, not a chunk: worker_threads loads it by
  // path at runtime, so it has to survive bundling as a file of its own.
  entry: [
    'src/index.ts',
    'src/cli/index.ts',
    'src/astro/index.ts',
    'src/vite/index.ts',
    'src/audit/runners/worker.ts',
  ],
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
