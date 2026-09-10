#!/usr/bin/env node
// What this tool costs, measured rather than remembered. Run with `pnpm bench`.
//
// Every performance claim in this repository used to be a number in a doc
// comment, produced once by a benchmark that no longer existed: the worker
// pool's thresholds are calibrated to "a 4-core box" nobody can find, and a
// regression in any recorded win would have been invisible. The numbers in the
// changelog and in docs/audit.md come from here, so anybody can re-run them on
// their own machine and disagree with evidence.
//
// Deliberately not a CI gate. Timing on a shared runner is noise, and a gate
// that goes red on somebody else's neighbour teaches people to ignore it. This
// prints a table two checkouts can be compared on, and stops there.
//
// Everything is measured through the built CLI as a separate process, because
// that is what a user waits for: module loading, the engine, the report and the
// process itself, in the proportions they actually occur.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import path from 'node:path'

const CLI = path.resolve('dist/cli/index.js')

/** Runs per measurement, plus one warm-up that is thrown away. */
const RUNS = 5

/** Pages in the site the per-page and cache numbers are measured over. */
const PAGES = 20

/**
 * A page with enough markup to be worth parsing, and enough wrong with it to be
 * worth reporting: an image with no alt text, a link whose only content is one,
 * and a field with no label.
 *
 * Its own template rather than one of the test fixtures, so these numbers move
 * when the tool changes and not when a fixture does.
 */
function page(index) {
  const menu = Array.from(
    { length: 8 },
    (_, i) => `<li><a href="/seite-${i}.html">Seite ${i}</a></li>`,
  ).join('\n')
  const rows = Array.from(
    { length: 12 },
    (_, row) => `<tr><td>Zeile ${row}</td><td>${row * index}</td><td>ok</td></tr>`,
  ).join('')
  const sections = Array.from(
    { length: 6 },
    (_, i) =>
      `<section><h2>Abschnitt ${i}</h2><p>Text ${i}, lang genug für eine Zeile.</p></section>`,
  ).join('\n')

  return `<!doctype html>
<html lang="de">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Seite ${index}</title></head>
<body>
<header><nav aria-label="Hauptmenü"><ul>${menu}</ul></nav></header>
<main>
<h1>Seite ${index}</h1>
<p>Ein Absatz mit genug Text, dass die Seite nicht leer ist und die Regeln etwas zu prüfen haben.</p>
<img src="/bild-${index}.png">
<a href="/weiter-${index}.html"><img src="/pfeil.svg"></a>
<form><input type="text" name="suche"><button>Suchen</button></form>
<table><caption>Zahlen</caption><thead><tr><th>Name</th><th>Wert</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
${sections}
</main>
<footer><p>© 2026</p></footer>
</body></html>`
}

/** A site of `count` pages, each different from every other. */
function site(dir, count) {
  mkdirSync(dir, { recursive: true })
  for (let i = 0; i < count; i += 1) writeFileSync(path.join(dir, `seite-${i}.html`), page(i))
  return dir
}

/**
 * One run of the CLI, in milliseconds.
 *
 * Exit 1 is an audit that found violations, which these pages all do. Exit 2 is
 * a run that reached no verdict at all, and timing that would be timing an
 * error path.
 */
function once(cwd, args) {
  const started = process.hrtime.bigint()
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6
  if (result.error || result.status === 2 || result.status === null) {
    console.error(`\nbench: \`${args.join(' ')}\` did not run (exit ${result.status})`)
    process.exit(1)
  }
  return elapsed
}

/**
 * The median of RUNS runs, after a warm-up.
 *
 * The median rather than the mean: one run in ten lands on a garbage collection
 * or a busy core, and a mean carries that outlier into the number for ever.
 *
 * `before` runs untimed ahead of every run, which is how a cold measurement
 * stays cold — emptying the cache is setup, not part of what is being measured.
 */
function median(cwd, args, before = () => {}) {
  before()
  once(cwd, args)
  const times = []
  for (let i = 0; i < RUNS; i += 1) {
    before()
    times.push(once(cwd, args))
  }
  return times.sort((a, b) => a - b)[Math.floor(RUNS / 2)]
}

function row(label, value) {
  console.log(`  ${label.padEnd(36)}${`${Math.round(value)} ms`.padStart(9)}`)
}

const root = mkdtempSync(path.join(tmpdir(), 'eaa-kit-bench-'))
const one = site(path.join(root, 'one'), 1)
const many = site(path.join(root, 'many'), PAGES)
const empty = (dir) => () => {
  rmSync(path.join(dir, '.eaa-kit'), { recursive: true, force: true })
}

console.log(
  `eaa-kit bench — node ${process.version}, ${process.platform} ${process.arch}, ${cpus().length} cores`,
)
console.log(`median of ${RUNS} runs, each after an untimed warm-up\n`)

console.log('Fixed cost')
row('eaa-kit --version', median(root, ['--version']))
const onePage = median(one, ['audit', '.', '--no-cache'], empty(one))
const manyPages = median(many, ['audit', '.', '--no-cache'], empty(many))
const perPage = (manyPages - onePage) / (PAGES - 1)
row('audit, 1 page', onePage)
row(`audit, ${PAGES} pages`, manyPages)
row('→ a page, at the margin', perPage)
row('→ everything before the first page', onePage - perPage)

console.log(`\nThe cache, over those ${PAGES} pages`)
row('cold (--no-cache)', manyPages)
empty(many)()
once(many, ['audit', '.'])
row('nothing changed', median(many, ['audit', '.']))
const first = path.join(many, 'seite-0.html')
let edit = 0
row(
  'one page changed',
  median(many, ['audit', '.'], () => {
    edit += 1
    writeFileSync(first, readFileSync(first, 'utf8').replace(/<h1>[^<]*<\/h1>/, `<h1>${edit}</h1>`))
  }),
)

console.log(`\nThe four reports, over those ${PAGES} pages with nothing to re-audit`)
console.log('  (what a renderer costs, with the engine out of the picture)')
once(many, ['audit', '.'])
for (const format of ['console', 'json', 'sarif', 'html']) {
  row(format, median(many, ['audit', '.', '--format', format, '--output', path.join(root, 'out')]))
}

console.log('\nThis machine, this afternoon. Compare two checkouts, never two laptops.')

rmSync(root, { recursive: true, force: true })
