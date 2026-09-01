#!/usr/bin/env node
// Regenerates examples/ from the test fixtures. Run with `pnpm examples`.
//
// A Node script rather than a shell one-liner because the audit exits 1 when it
// finds violations, which the fixtures always do, and `|| true` is not portable
// between the shells npm uses on Windows and POSIX.

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const CLI = 'dist/cli/index.js'
const FIXTURES = 'tests/fixtures/site'

const outputs = [
  { format: 'console', file: 'examples/console.txt' },
  { format: 'json', file: 'examples/report.json' },
  { format: 'sarif', file: 'examples/report.sarif' },
  { format: 'html', file: 'examples/report.html' },
]

// The last one is generated from examples/report.json, which the audit above
// has just rewritten, so the barriers it lists match the report next to it.
const statements = [
  { args: ['--lang', 'de'], file: 'examples/statement.de.md' },
  { args: ['--lang', 'en'], file: 'examples/statement.en.md' },
  { args: ['--lang', 'de'], file: 'examples/statement.de.html' },
  // One country whose statement is not the Austrian one, so the shape of a
  // non-DACH template is visible without running anything. One rather than
  // four: the other three differ from this in their statute and their
  // enforcement section, and four near-identical documents in the diff of
  // every release would be paid for on every release.
  { args: ['--country', 'FR', '--lang', 'fr'], file: 'examples/statement.fr.md' },
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

// A baseline built from the same fixtures, so the format has a worked example.
{
  const result = spawnSync(
    process.execPath,
    [CLI, 'baseline', FIXTURES, '--output', 'examples/baseline.json'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (result.status !== 0 || result.error) {
    console.error('failed to generate examples/baseline.json')
    process.exit(1)
  }
  console.log('wrote examples/baseline.json')
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

/**
 * Hold the run timestamp still.
 *
 * These files are checked in so the output formats can be reviewed as whole
 * documents. Every regeneration otherwise rewrites the one field that changes
 * on its own, so `git diff examples/` says something changed when nothing did —
 * and a real change hides among the noise the next time somebody looks.
 *
 * Done here rather than through a CLI flag: a way to fix the clock is a
 * testing seam, and the shipped tool should not carry one for the sake of its
 * own documentation.
 */
const FIXED = '2026-01-01T00:00:00.000Z'

for (const file of ['examples/report.json', 'examples/report.sarif', 'examples/report.html']) {
  const before = await readFile(file, 'utf8')
  const after = before.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, FIXED)
  if (after !== before) {
    await writeFile(file, after, 'utf8')
    console.log(`normalised the timestamp in ${file}`)
  }
}
