import pc from 'picocolors'
import {
  type DiffEntry,
  DiffError,
  diffReports,
  type ReportDiff,
  readReport,
} from '../audit/diff.ts'
import { DEFAULT_FAIL_ON, type ImpactLevel, meetsThreshold } from '../audit/impact.ts'
import { collapse, count } from '../text.ts'
import { emitDocument, fail, note, warn } from './command.ts'

/**
 * `eaa-kit diff <before.json> <after.json>`.
 *
 * What a change did to a site's accessibility, which is the question a review
 * actually asks and which neither report answers on its own. Running the
 * auditor on a branch prints everything wrong with the site; almost all of it
 * was already there, and the two or three findings somebody introduced are
 * somewhere in the middle of it.
 *
 * Deliberately stateless. A baseline is a file somebody commits and maintains,
 * and it answers "what have we agreed to live with". This answers "what did
 * this change do", needs no file and no decision, and can be run over any two
 * reports after the fact.
 */

export const DIFF_FORMATS = ['console', 'json'] as const

export type DiffFormat = (typeof DIFF_FORMATS)[number]

export interface DiffCommandOptions {
  format?: DiffFormat
  /** Write the report here instead of stdout. */
  output?: string
  /**
   * Lowest impact that fails the run. Only new violations are judged: a diff
   * that failed on pre-existing ones would be an audit with extra steps.
   */
  failOn?: ImpactLevel
  cwd?: string
}

export interface DiffCommandResult {
  diff?: ReportDiff
  /** 0 nothing new, 1 new violations at or above the threshold, 2 could not run. */
  exitCode: number
}

/** Longest element markup shown before it is truncated. */
const MAX_SNIPPET = 100

export async function runDiffCommand(
  base: string,
  head: string,
  options: DiffCommandOptions = {},
): Promise<DiffCommandResult> {
  const cwd = options.cwd ?? process.cwd()

  let diff: ReportDiff
  try {
    // Sequentially, so an error names the file that caused it rather than
    // whichever of the two happened to reject first.
    const before = await readReport(base, cwd)
    const after = await readReport(head, cwd)
    diff = diffReports(before, after)
  } catch (cause) {
    if (cause instanceof DiffError) {
      fail(cause.message)
      return { exitCode: 2 }
    }
    throw cause
  }

  const failOn = options.failOn ?? DEFAULT_FAIL_ON
  const failing = diff.added.filter((entry) => meetsThreshold(entry.impact, failOn))

  const format = options.format ?? 'console'
  const body =
    format === 'json'
      ? `${JSON.stringify(toJson(diff, failOn, failing.length), null, 2)}\n`
      : `${formatDiff(diff, failOn, options.output === undefined)}\n`

  await emitDocument(body, options.output, cwd)
  if (options.output !== undefined) note(`Diff written to ${options.output}`)

  // Said on stderr as well as in the document, because the document may have
  // gone to a file and this is the part somebody has to act on.
  if (diff.unmeasured.length > 0) {
    warn(
      `${count(diff.unmeasured.length, 'violation')} could not be compared: the later run did not audit ${
        diff.unmeasured.length === 1 ? 'its page' : 'their pages'
      }`,
    )
  }

  return { diff, exitCode: failing.length > 0 ? 1 : 0 }
}

interface JsonDiff {
  base: ReportDiff['base']
  head: ReportDiff['head']
  summary: {
    added: number
    fixed: number
    unchanged: number
    unmeasured: number
    failOn: ImpactLevel
    failing: number
  }
  added: DiffEntry[]
  fixed: DiffEntry[]
  unmeasured: DiffEntry[]
}

/**
 * The machine-readable form.
 *
 * `unchanged` is counted and not listed: it is the whole of the pre-existing
 * report, it is already available in the report itself, and repeating it here
 * would make the common case — a diff with three entries — a document nobody
 * can read.
 */
function toJson(diff: ReportDiff, failOn: ImpactLevel, failing: number): JsonDiff {
  return {
    base: diff.base,
    head: diff.head,
    summary: {
      added: diff.added.length,
      fixed: diff.fixed.length,
      unchanged: diff.unchanged.length,
      unmeasured: diff.unmeasured.length,
      failOn,
      failing,
    },
    added: diff.added,
    fixed: diff.fixed,
    unmeasured: diff.unmeasured,
  }
}

export function formatDiff(diff: ReportDiff, failOn: ImpactLevel, colour = true): string {
  const c = pc.createColors(colour)
  const lines: string[] = ['']

  lines.push(c.bold('eaa-kit diff'))
  lines.push(c.dim(`  before  ${describe(diff.base)}`))
  lines.push(c.dim(`  after   ${describe(diff.head)}`))
  lines.push('')

  if (diff.added.length === 0 && diff.fixed.length === 0) {
    lines.push(c.green('No change in violations.'))
  }

  if (diff.added.length > 0) {
    lines.push(c.red(c.bold(`New (${diff.added.length})`)))
    lines.push(...diff.added.map((entry) => entryLine(entry, c)))
    lines.push('')
  }

  if (diff.fixed.length > 0) {
    lines.push(c.green(c.bold(`Fixed (${diff.fixed.length})`)))
    lines.push(...diff.fixed.map((entry) => entryLine(entry, c)))
    lines.push('')
  }

  // Neither fixed nor still failing. Listed rather than counted, because the
  // useful part is which pages stopped being looked at.
  if (diff.unmeasured.length > 0) {
    lines.push(c.yellow(c.bold(`Not compared (${diff.unmeasured.length})`)))
    lines.push(
      c.dim('  These failed before, and the later run did not audit the page they were on.'),
    )
    lines.push(...diff.unmeasured.map((entry) => entryLine(entry, c)))
    lines.push('')
  }

  const failing = diff.added.filter((entry) => meetsThreshold(entry.impact, failOn)).length
  lines.push(c.bold('Summary'))
  lines.push(
    `  ${diff.added.length} new · ${diff.fixed.length} fixed · ${diff.unchanged.length} unchanged`,
  )
  lines.push(
    failing > 0
      ? c.red(`  ${failing} new at or above ${failOn} (--fail-on ${failOn})`)
      : c.green(`  no new violations at or above ${failOn} (--fail-on ${failOn})`),
  )

  return lines.join('\n')
}

function describe(side: ReportDiff['base']): string {
  const source = side.source === '' ? 'unknown source' : side.source
  const coverage =
    side.complete === undefined
      ? 'coverage not recorded'
      : side.complete
        ? 'complete'
        : 'incomplete'
  return `${source} · ${count(side.audited, 'page')} · ${coverage} · ${side.generatedAt}`
}

function entryLine(entry: DiffEntry, c: ReturnType<typeof pc.createColors>): string {
  const where = entry.selector === '' ? entry.page : `${entry.page} ${c.dim(entry.selector)}`
  const impact = entry.impact ?? 'unclassified'
  const snippet = entry.html === '' ? '' : `\n      ${c.dim(collapse(entry.html, MAX_SNIPPET))}`
  return `  ${c.bold(entry.ruleId)} ${c.dim(`(${impact})`)} — ${entry.help}\n    ${where}${snippet}`
}
