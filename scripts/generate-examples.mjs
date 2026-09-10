#!/usr/bin/env node
// Regenerates examples/ from the test fixtures. Run with `pnpm examples`.
//
// A Node script rather than a shell one-liner because the audit exits 1 when it
// finds violations, which the fixtures always do, and `|| true` is not portable
// between the shells npm uses on Windows and POSIX.

import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

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

/**
 * Hold the clock still.
 *
 * These files are checked in so the output formats can be reviewed as whole
 * documents, and CI regenerates them to prove a refactor changed no output.
 * Every regeneration otherwise rewrites the fields that move on their own, so
 * `git diff examples/` says something changed when nothing did — and a real
 * change hides among the noise, in the one check meant to catch it.
 *
 * Two shapes of clock, because two commands write one: the run timestamp in a
 * report, and the day a baseline was recorded, which the statement then quotes
 * back as prose in whatever language it is written in. Freezing the report
 * before the statements are generated is what makes that prose stand still
 * too — normalising it afterwards would leave the German date behind.
 *
 * And one shape of place. A JSON report records the URL each page was audited
 * at, which for a build directory is a `file://` URL under wherever the
 * repository happens to sit — `/home/runner/work` on CI, something else on
 * every laptop. That is correct in a report somebody runs and meaningless in
 * one checked into a repository, so the root is replaced by a fixed stand-in.
 * It is the same idea as the clock: the example is a document about the
 * format, and the parts of it that describe the machine that produced it are
 * noise that would bury a real change.
 *
 * Done here rather than through a CLI flag: a way to fix the clock or the
 * paths is a testing seam, and the shipped tool should not carry one for the
 * sake of its own documentation.
 */
const FIXED = '2026-01-01T00:00:00.000Z'
const FIXED_DAY = '2026-01-01'
const FIXED_ROOT = 'file:///eaa-kit'

async function freezeClock(file) {
  const before = await readFile(file, 'utf8')
  const after = before
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, FIXED)
    .replace(/("(?:createdOn|acceptedOn)": ")\d{4}-\d{2}-\d{2}(")/g, `$1${FIXED_DAY}$2`)
    .replaceAll(root, FIXED_ROOT)
  if (after !== before) {
    await writeFile(file, after, 'utf8')
    console.log(`froze the clock in ${file}`)
  }
}

/** This checkout, as the `file://` URL a report writes it as, without a trailing slash. */
const root = pathToFileURL(process.cwd()).href.replace(/\/$/, '')

await mkdir('examples', { recursive: true })

for (const { format, file } of outputs) {
  const result = spawnSync(
    process.execPath,
    // `--no-cache` for the same reason the clock is frozen: these documents
    // describe the formats, and a run that reused an earlier result says so in
    // all four of them. Whether a checkout happens to have a cache is not a
    // property of the format, and CI regenerating these must not depend on it.
    [CLI, 'audit', FIXTURES, '--format', format, '--no-cache', '--output', file],
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

for (const { file } of outputs) {
  await freezeClock(file)
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
  await freezeClock('examples/baseline.json')
}

// The manual review: the record, expanded to every criterion from the four
// answers checked in above, and the worksheet generated from it.
{
  const result = spawnSync(
    process.execPath,
    [CLI, 'checklist', '--record', 'examples/eaa-review.json', '--output', 'examples/review.md'],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  )
  if (result.status !== 0 || result.error) {
    console.error('failed to generate examples/review.md')
    process.exit(1)
  }
  console.log('wrote examples/review.md')
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
