#!/usr/bin/env node
// Regenerates examples/ from the test fixtures. Run with `pnpm examples`.
//
// A Node script rather than a shell one-liner because the audit exits 1 when it
// finds violations, which the fixtures always do, and `|| true` is not portable
// between the shells npm uses on Windows and POSIX.

import { spawnSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const CLI = 'dist/cli/index.js'
const FIXTURES = 'tests/fixtures/site'

const outputs = [
  { format: 'console', file: 'examples/console.txt' },
  { format: 'json', file: 'examples/report.json' },
  { format: 'sarif', file: 'examples/report.sarif' },
]

// The last one is generated from examples/report.json, which the audit above
// has just rewritten, so the barriers it lists match the report next to it.
const statements = [
  { args: ['--lang', 'de'], file: 'examples/statement.de.md' },
  { args: ['--lang', 'en'], file: 'examples/statement.en.md' },
  { args: ['--lang', 'de'], file: 'examples/statement.de.html' },
  {
    args: ['--lang', 'de', '--audit', 'examples/report.json'],
    file: 'examples/statement.audit.de.md',
  },
]

await mkdir('examples', { recursive: true })

for (const { format, file } of outputs) {
  const result = spawnSync(
    process.execPath,
    [CLI, 'audit', FIXTURES, '--format', format, '--output', file],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )

  // 0 clean, 1 violations found; both produced a report. 2 means it could not
  // run at all, which is a real failure.
  if (result.status === 2 || result.error) {
    console.error(`failed to generate ${file}`)
    process.exit(1)
  }
  console.log(`wrote ${file}`)
}

for (const { args, file } of statements) {
  const result = spawnSync(
    process.execPath,
    [CLI, 'statement', '--config', 'examples/eaa.config.json', ...args, '--output', file],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (result.status !== 0 || result.error) {
    console.error(`failed to generate ${file}`)
    process.exit(1)
  }
  console.log(`wrote ${file}`)
}
