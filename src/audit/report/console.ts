import pc from 'picocolors'
import { countAtOrAbove, DEFAULT_FAIL_ON, IMPACT_LEVELS, type ImpactLevel } from '../impact.ts'
import type { Finding, IncompleteFinding, PageAudit } from '../runners/jsdom.ts'

export interface ConsoleReportOptions {
  /** Build directory the audit ran against, shown in the header. */
  dir?: string
  /** Terminal width to wrap at. Defaults to the real terminal, or 80. */
  width?: number
  /** Force colour on or off. Defaults to picocolors' own detection. */
  color?: boolean
  /** Elements listed per rule before the rest are summarised. */
  maxNodes?: number
  /** Threshold the run will be judged against, echoed in the summary. */
  failOn?: ImpactLevel
}

const DEFAULT_MAX_NODES = 3
const MIN_WIDTH = 40
const MAX_WIDTH = 100

/**
 * Human-readable audit report.
 *
 * Deliberately not a columnar table: rule ids, help text and selectors are all
 * variable-length, so a real table either wraps into soup or scrolls sideways
 * on a narrow terminal. Everything is left-aligned and indented instead, and
 * every line is assembled from segments trimmed as a group, so the width
 * guarantee holds however long a selector or rule id turns out to be.
 *
 * Returns a string rather than printing, so the format is testable.
 */
export function formatConsoleReport(
  audits: readonly PageAudit[],
  options: ConsoleReportOptions = {},
): string {
  const ctx = context(options)
  const lines: string[] = ['', ...headerLines(audits, ctx), '']

  for (const audit of audits) {
    lines.push(...pageSection(audit, ctx))
  }
  lines.push(...summary(audits, ctx))

  return lines.join('\n')
}

interface Segment {
  text: string
  paint?: (text: string) => string
}

interface Context {
  width: number
  maxNodes: number
  failOn: ImpactLevel
  c: ReturnType<typeof pc.createColors>
  symbol: (kind: 'violation' | 'review' | 'blind' | 'clean' | 'error') => string
}

function context(options: ConsoleReportOptions): Context {
  const detected = process.stdout.columns ?? 80
  const width = Math.min(Math.max(options.width ?? detected, MIN_WIDTH), MAX_WIDTH)
  const c = pc.createColors(options.color ?? pc.isColorSupported)
  const unicode = supportsUnicode()

  return {
    width,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    failOn: options.failOn ?? DEFAULT_FAIL_ON,
    c,
    symbol: (kind) => {
      switch (kind) {
        case 'violation':
          return unicode ? '✗' : 'x'
        case 'review':
          return '?'
        case 'blind':
          return unicode ? '·' : '-'
        case 'clean':
          return unicode ? '✓' : '+'
        case 'error':
          return '!'
      }
    },
  }
}

/** cmd.exe and older Windows consoles render these glyphs as mojibake. */
function supportsUnicode(): boolean {
  if (process.platform !== 'win32') return true
  return Boolean(
    process.env['WT_SESSION'] ||
      process.env['TERM_PROGRAM'] ||
      process.env['ConEmuTask'] ||
      process.env['TERM'],
  )
}

/**
 * Joins segments into one line, trimming the group to the terminal width.
 * Colour codes are applied after trimming, so they never count towards it.
 */
function render(ctx: Context, segments: Segment[]): string {
  let remaining = ctx.width
  const parts: string[] = []

  for (const segment of segments) {
    if (remaining <= 0) break
    const fits = segment.text.length <= remaining
    const text = fits ? segment.text : `${segment.text.slice(0, Math.max(remaining - 1, 0))}…`
    remaining -= text.length
    parts.push(segment.paint ? segment.paint(text) : text)
  }

  return parts.join('')
}

function headerLines(audits: readonly PageAudit[], ctx: Context): string[] {
  const engine = audits[0]?.engine ?? 'jsdom'
  const pageCount = `${audits.length} ${plural(audits.length, 'page')}`
  return [
    render(ctx, [
      { text: 'eaa-kit audit', paint: ctx.c.bold },
      { text: ` ${pageCount} · ${engine} (browserless)`, paint: ctx.c.dim },
    ]),
    // "Not applicable" reads like good news unless it is spelled out.
    render(ctx, [
      { text: 'passed = checked and met · not applicable = nothing to check', paint: ctx.c.dim },
    ]),
  ]
}

function pageSection(audit: PageAudit, ctx: Context): string[] {
  const lines: string[] = [render(ctx, [{ text: audit.relativePath, paint: ctx.c.underline }])]

  if (audit.error) {
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('error')} not audited: `, paint: ctx.c.red },
        { text: audit.error },
      ]),
      '',
    )
    return lines
  }

  for (const finding of sortByImpact(audit.violations)) {
    lines.push(...violationLines(finding, ctx))
  }

  for (const finding of audit.incomplete.filter((item) => item.reason === 'needs-review')) {
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('review')} `, paint: ctx.c.yellow },
        { text: finding.ruleId, paint: ctx.c.yellow },
        { text: ` needs manual review${criteria(finding)}`, paint: ctx.c.dim },
      ]),
    )
  }

  if (audit.violations.length === 0) {
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('clean')} `, paint: ctx.c.green },
        { text: 'no violations', paint: ctx.c.green },
      ]),
    )
  }

  lines.push(coverageLine(audit, ctx))
  lines.push('')
  return lines
}

/**
 * What this page's result actually rests on.
 *
 * The four counts stay separate on purpose. Only `passed` is evidence that a
 * criterion was met here; `not applicable` means the rule found nothing to
 * check, and adding the two together would turn an empty page into a
 * near-perfect score.
 */
function coverageLine(audit: PageAudit, ctx: Context): string {
  const blind = audit.incomplete.filter((finding) => finding.reason === 'engine-limitation').length
  const review = audit.incomplete.length - blind
  const parts = [`${audit.passes.length} passed`, `${audit.inapplicable.length} not applicable`]
  if (review > 0) parts.push(`${review} to review`)
  if (blind > 0) parts.push(`${blind} not evaluated`)

  return render(ctx, [{ text: `    ${parts.join(' · ')}`, paint: ctx.c.dim }])
}

function violationLines(finding: Finding, ctx: Context): string[] {
  const impact = finding.impact ?? 'unknown'
  const lines = [
    render(ctx, [
      { text: `  ${ctx.symbol('violation')} `, paint: ctx.c.red },
      { text: finding.ruleId, paint: ctx.c.bold },
      { text: ` ${impact}${criteria(finding)}`, paint: ctx.c.dim },
    ]),
    render(ctx, [{ text: `      ${finding.help}` }]),
  ]

  for (const node of finding.nodes.slice(0, ctx.maxNodes)) {
    lines.push(render(ctx, [{ text: `      ${node.target.join(' ')}`, paint: ctx.c.cyan }]))
    lines.push(render(ctx, [{ text: `        ${collapse(node.html)}`, paint: ctx.c.dim }]))
  }

  const hidden = finding.nodes.length - ctx.maxNodes
  if (hidden > 0) {
    lines.push(
      render(ctx, [
        { text: `      + ${hidden} more ${plural(hidden, 'element')}`, paint: ctx.c.dim },
      ]),
    )
  }

  return lines
}

function summary(audits: readonly PageAudit[], ctx: Context): string[] {
  const withViolations = audits.filter((audit) => audit.violations.length > 0)
  const errored = audits.filter((audit) => audit.error)
  const ruleCount = audits.reduce((total, audit) => total + audit.violations.length, 0)
  const elementCount = audits.reduce(
    (total, audit) =>
      total + audit.violations.reduce((sum, finding) => sum + finding.nodes.length, 0),
    0,
  )
  const reviewCount = countRules(audits, 'needs-review')
  const pages = `${audits.length} ${plural(audits.length, 'page')}`

  const lines = [render(ctx, [{ text: 'Summary', paint: ctx.c.bold }])]

  if (ruleCount === 0) {
    lines.push(render(ctx, [{ text: `  No violations across ${pages}.`, paint: ctx.c.green }]))
  } else {
    lines.push(
      render(ctx, [
        {
          text: `  ${ruleCount} ${plural(ruleCount, 'violation')} on ${withViolations.length} of ${pages}`,
          paint: ctx.c.red,
        },
        { text: ` (${elementCount} ${plural(elementCount, 'element')})`, paint: ctx.c.dim },
      ]),
    )
    lines.push(thresholdLine(audits, ctx))
  }

  if (reviewCount > 0) {
    lines.push(
      render(ctx, [
        {
          text: `  ${reviewCount} ${plural(reviewCount, 'rule')} ${reviewCount === 1 ? 'needs' : 'need'} manual review`,
          paint: ctx.c.yellow,
        },
      ]),
    )
  }

  if (errored.length > 0) {
    lines.push(
      render(ctx, [
        {
          text: `  ${errored.length} ${plural(errored.length, 'page')} could not be audited`,
          paint: ctx.c.red,
        },
      ]),
    )
  }

  lines.push(...blindSection(audits, ctx))
  return lines
}

/**
 * Why the run passed or failed. Without this, a build that exits 0 while the
 * report lists violations looks like a bug rather than a threshold choice.
 */
function thresholdLine(audits: readonly PageAudit[], ctx: Context): string {
  const failOn = ctx.failOn
  const failing = countAtOrAbove(audits, failOn)

  if (failing === 0) {
    return render(ctx, [
      {
        text: `  none at or above ${failOn} (--fail-on ${failOn}), so this run passes`,
        paint: ctx.c.green,
      },
    ])
  }

  return render(ctx, [
    {
      text: `  ${failing} at or above ${failOn} (--fail-on ${failOn})`,
      paint: ctx.c.red,
    },
  ])
}

/**
 * The unevaluated rules are listed once, at the end, rather than repeated under
 * every page: on a large site the same handful recurs on each one, and a wall
 * of "not evaluated" would bury the findings that are real.
 */
function blindSection(audits: readonly PageAudit[], ctx: Context): string[] {
  const byRule = new Map<string, { pages: number; finding: IncompleteFinding }>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason !== 'engine-limitation') continue
      const entry = byRule.get(finding.ruleId)
      if (entry) entry.pages += 1
      else byRule.set(finding.ruleId, { pages: 1, finding })
    }
  }
  if (byRule.size === 0) return []

  const lines = [
    '',
    render(ctx, [{ text: 'Not evaluated', paint: ctx.c.bold }]),
    render(ctx, [{ text: '  This engine reached no verdict on these.', paint: ctx.c.dim }]),
    render(ctx, [{ text: '  They are never reported as passing.', paint: ctx.c.dim }]),
  ]

  for (const [ruleId, { pages, finding }] of [...byRule].sort((a, b) => b[1].pages - a[1].pages)) {
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('blind')} ` },
        { text: ruleId },
        { text: ` ${pages} ${plural(pages, 'page')}${criteria(finding)}`, paint: ctx.c.dim },
      ]),
    )
    lines.push(render(ctx, [{ text: `      ${finding.reasonDetail}`, paint: ctx.c.dim }]))
  }

  return lines
}

function countRules(audits: readonly PageAudit[], reason: IncompleteFinding['reason']): number {
  const ruleIds = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === reason) ruleIds.add(finding.ruleId)
    }
  }
  return ruleIds.size
}

function sortByImpact(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const rank = impactRank(a) - impactRank(b)
    return rank === 0 ? a.ruleId.localeCompare(b.ruleId) : rank
  })
}

/** Most severe first; anything axe-core left unclassified sorts last. */
function impactRank(finding: Finding): number {
  const index = IMPACT_LEVELS.indexOf(finding.impact as ImpactLevel)
  return index === -1 ? IMPACT_LEVELS.length : IMPACT_LEVELS.length - index
}

function criteria(finding: Finding): string {
  return finding.successCriteria.length > 0 ? `, WCAG ${finding.successCriteria.join(' ')}` : ''
}

function collapse(html: string): string {
  return html.replace(/\s+/g, ' ').trim()
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}
