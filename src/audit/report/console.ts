import pc from 'picocolors'
import { collapse, count, plural } from '../../text.ts'
import { discoveryLabel, missedParts, type RunCompleteness } from '../completeness.ts'
import { type ComponentLocation, componentPath } from '../component.ts'
import { buildCoverage, type Coverage, coverageSummary } from '../coverage.ts'
import {
  countAtOrAbove,
  DEFAULT_FAIL_ON,
  type ImpactLevel,
  impactLabel,
  impactRank,
} from '../impact.ts'
import { blindRules, coverageParts, groupIssues, type IssueElement, isShared } from '../issues.ts'
import { manualCheckFor, understandingUrl } from '../manual.ts'
import { remediationFor } from '../remediation.ts'
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
  /** Maps an audited page to the source file that produced it, when known. */
  sourceFor?: (pagePath: string) => string | undefined
  /**
   * Maps a failing element to the source file it was written in. Where route
   * mapping names the page, this names the component the page only renders.
   */
  componentFor?: (html: string) => ComponentLocation | undefined
  /**
   * List every page and its result, under the issues. Off by default: on a
   * fifty-page site it is a wall, and what somebody needs first is what is
   * broken, not a roll call of pages that are fine.
   */
  perPage?: boolean
  /**
   * Print the manual check for each rule this engine could not evaluate, and a
   * link to what the criterion requires. Off by default: it is several lines
   * per rule, and somebody re-running an audit they already understand does not
   * need it every time.
   */
  manual?: boolean
  /**
   * What the run measured and what it never reached.
   *
   * Optional rather than required only so a caller rendering a report by hand
   * need not synthesise one; the CLI always supplies it. A report built without
   * it says nothing about coverage of the site rather than claiming it was
   * complete.
   */
  completeness?: RunCompleteness
  /**
   * List every WCAG 2.2 A/AA criterion and what this run reached on it. Off by
   * default: it is fifty-five lines, and the one-line summary above it carries
   * the part that changes how the report reads.
   */
  coverage?: boolean
  /**
   * Registry id of the framework this project uses, so the advice can be given
   * in its idiom where that differs. Undefined falls back to the generic fix,
   * which for most rules is the same one.
   */
  framework?: string
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

  // Issues first: what is broken and where, once per element. The page-by-page
  // listing is the same information keyed the other way round, and reading it
  // is only the job when somebody is working through one page.
  lines.push(...issuesSection(audits, ctx))

  if (options.perPage) {
    lines.push('', ...legendLines(ctx), '')
    for (const audit of audits) {
      lines.push(...pageSection(audit, ctx))
    }
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
  sourceFor: (pagePath: string) => string | undefined
  componentFor: (html: string) => ComponentLocation | undefined
  manual: boolean
  coverage: boolean
  framework: string | undefined
  c: ReturnType<typeof pc.createColors>
  symbol: (kind: 'violation' | 'review' | 'blind' | 'clean' | 'error') => string
  completeness: RunCompleteness | undefined
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
    sourceFor: options.sourceFor ?? (() => undefined),
    componentFor: options.componentFor ?? (() => undefined),
    manual: options.manual ?? false,
    coverage: options.coverage ?? false,
    framework: options.framework,
    completeness: options.completeness,
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

/** One line from a single segment, which is what most of this report is. */
function line(ctx: Context, text: string, paint?: Segment['paint']): string {
  return render(ctx, paint === undefined ? [{ text }] : [{ text, paint }])
}

function headerLines(audits: readonly PageAudit[], ctx: Context): string[] {
  const engine = audits[0]?.engine ?? 'jsdom'
  // The label has to follow the engine: calling a Chromium run "browserless"
  // was the first thing wrong with the browser mode's output.
  const engineLabel = engine === 'browser' ? 'chromium' : 'jsdom (browserless)'
  return [
    render(ctx, [
      { text: 'eaa-kit audit', paint: ctx.c.bold },
      { text: ` ${count(audits.length, 'page')} · ${engineLabel}`, paint: ctx.c.dim },
    ]),
  ]
}

/**
 * What the per-page counts mean.
 *
 * Only with the per-page listing, which is the only place those words appear:
 * "not applicable" reads like good news unless it is spelled out, and printing
 * the gloss for a section that is not there is noise.
 */
function legendLines(ctx: Context): string[] {
  return [line(ctx, 'passed = checked and met · not applicable = nothing to check', ctx.c.dim)]
}

function pageSection(audit: PageAudit, ctx: Context): string[] {
  const lines: string[] = [line(ctx, audit.relativePath, ctx.c.underline)]

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
    // "No violations" would be a lie on a page whose violations were all
    // accepted by a baseline. They are still there; they just do not fail the
    // run, and the line below says which of the two this is.
    const clean = (audit.accepted ?? []).length === 0
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('clean')} `, paint: clean ? ctx.c.green : ctx.c.dim },
        {
          text: clean ? 'no violations' : 'no new violations',
          paint: clean ? ctx.c.green : ctx.c.dim,
        },
      ]),
    )
  }

  for (const finding of sortByImpact(audit.accepted ?? [])) {
    const elements = count(finding.nodes.length, 'element')
    lines.push(line(ctx, `  · ${finding.ruleId} accepted by the baseline (${elements})`, ctx.c.dim))
  }

  lines.push(coverageLine(audit, ctx))
  lines.push('')
  return lines
}

function coverageLine(audit: PageAudit, ctx: Context): string {
  return line(ctx, `    ${coverageParts(audit).join(' · ')}`, ctx.c.dim)
}

function violationLines(finding: Finding, ctx: Context): string[] {
  const impact = finding.impact ?? 'unknown'
  const lines = [
    render(ctx, [
      { text: `  ${ctx.symbol('violation')} `, paint: ctx.c.red },
      { text: finding.ruleId, paint: ctx.c.bold },
      { text: ` ${impact}${criteria(finding)}`, paint: ctx.c.dim },
    ]),
    line(ctx, `      ${finding.help}`),
  ]

  for (const node of finding.nodes.slice(0, ctx.maxNodes)) {
    lines.push(line(ctx, `      ${node.target.join(' ')}`, ctx.c.cyan))
    lines.push(line(ctx, `        ${collapse(node.html)}`, ctx.c.dim))
  }

  const hidden = finding.nodes.length - ctx.maxNodes
  if (hidden > 0) {
    lines.push(line(ctx, `      + ${count(hidden, 'more element')}`, ctx.c.dim))
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
  const pages = count(audits.length, 'page')
  // A page that errored produced no findings because nothing read it, so it is
  // not one of the pages a "no violations" sentence can be counted over.
  const audited = audits.length - errored.length

  const lines = [line(ctx, 'Summary', ctx.c.bold), ...completenessLines(ctx)]

  if (ruleCount === 0 && audited === 0 && errored.length > 0) {
    // Every page this run was given failed. "No violations" here would be a
    // pass handed back for markup nothing ever opened, so the count is not
    // printed as a verdict at all and the error line below carries the result.
    // A run with no pages is a different thing and keeps its own wording: there
    // was nothing to fail.
    lines.push(line(ctx, '  Nothing was audited: no page could be read.', ctx.c.red))
  } else if (ruleCount === 0) {
    // Qualified rather than plain when the run did not see the whole site: "no
    // violations" over a fraction of the pages is not the sentence it looks
    // like, and the completeness lines above have just said which fraction.
    // The count is of pages actually audited, not of pages attempted: saying
    // "no violations across 2 pages" when one of them errored claims a verdict
    // on a page nothing looked at.
    const incomplete = errored.length > 0 || (ctx.completeness && !ctx.completeness.complete)
    const clean = incomplete
      ? `  No violations across the ${count(audited, 'page')} that were audited.`
      : `  No violations across ${pages}.`
    lines.push(line(ctx, clean, ctx.c.green))
  } else {
    lines.push(
      render(ctx, [
        {
          // Out of the pages audited, not the pages attempted: "on 1 of 2
          // pages" reads as one clean page when the other one errored.
          text: `  ${count(ruleCount, 'violation')} on ${withViolations.length} of ${count(audited, 'page')}`,
          paint: ctx.c.red,
        },
        { text: ` (${count(elementCount, 'element')})`, paint: ctx.c.dim },
      ]),
    )
    lines.push(thresholdLine(audits, ctx))
  }

  if (reviewCount > 0) {
    const verb = reviewCount === 1 ? 'needs' : 'need'
    lines.push(line(ctx, `  ${count(reviewCount, 'rule')} ${verb} manual review`, ctx.c.yellow))
  }

  if (errored.length > 0) {
    lines.push(line(ctx, `  ${count(errored.length, 'page')} could not be audited`, ctx.c.red))
  }

  const accepted = audits.reduce(
    (total, audit) =>
      total + (audit.accepted ?? []).reduce((sum, finding) => sum + finding.nodes.length, 0),
    0,
  )
  if (accepted > 0) {
    // Counted and named, never folded into the passes: a barrier somebody
    // agreed to defer is not a criterion that was met.
    lines.push(
      line(
        ctx,
        `  ${count(accepted, 'element')} accepted by the baseline, not counted above`,
        ctx.c.dim,
      ),
    )
  }

  lines.push(...blindSection(audits, ctx))
  lines.push(...coverageSection(audits, ctx))
  return lines
}

/**
 * How much of the standard this run could reach.
 *
 * One line by default. It is the sentence that stops a clean report reading as
 * a clean site: most of WCAG cannot be checked by any automated engine, and
 * until this was printed the report said so only in prose, in the footer, where
 * it could be read as boilerplate.
 */
function coverageSection(audits: readonly PageAudit[], ctx: Context): string[] {
  const coverage = buildCoverage(audits)
  const lines = [
    '',
    ...wrap(coverageSummary(coverage), ctx.width - 2).map((text) =>
      line(ctx, `  ${text}`, ctx.c.dim),
    ),
  ]

  if (coverage.browserWouldAnswer > 0) {
    const verb = coverage.browserWouldAnswer === 1 ? 'criterion' : 'criteria'
    lines.push(
      line(ctx, `  --browser would answer ${coverage.browserWouldAnswer} more ${verb}.`, ctx.c.dim),
    )
  }

  if (!ctx.coverage) {
    lines.push(
      line(ctx, '  Run with --coverage for the criterion-by-criterion breakdown.', ctx.c.dim),
    )
    return lines
  }

  lines.push('', line(ctx, 'Coverage', ctx.c.bold))
  for (const criterion of coverage.criteria) {
    const paint = criterion.status === 'evaluated' ? ctx.c.green : ctx.c.dim
    const note = criterion.browserWouldAnswer ? ' (--browser would answer this)' : ''
    lines.push(
      render(ctx, [
        { text: `  ${criterion.number} `, paint: ctx.c.bold },
        { text: `${criterion.title} (${criterion.level}) — ` },
        { text: `${STATUS_WORDS[criterion.status]}${note}`, paint },
      ]),
    )
  }
  return lines
}

/** What each outcome is called, in words rather than a symbol. */
const STATUS_WORDS: Record<Coverage['criteria'][number]['status'], string> = {
  evaluated: 'evaluated here',
  'not-evaluated': 'this engine could not evaluate it',
  'nothing-to-check': 'rules ran and found nothing on this site to check',
  'no-automated-rule': 'no automated rule exists; a person must check it',
}

/**
 * What the run never looked at.
 *
 * Printed before the counts rather than after them, because it changes how they
 * read: "no violations" means one thing over a whole site and another over the
 * twelve pages of it a crawl managed to fetch before it hit its limit.
 *
 * Pages that errored are left to the summary's own line, which already names
 * them; repeating the number here would read as twice as many.
 */
function completenessLines(ctx: Context): string[] {
  const completeness = ctx.completeness
  if (completeness === undefined || completeness.complete) return []

  const lines: string[] = []

  if (completeness.unreachable.length > 0) {
    const noun = plural(completeness.unreachable.length, 'page')
    const verb = completeness.unreachable.length === 1 ? 'was' : 'were'
    lines.push(
      line(
        ctx,
        `  ${completeness.unreachable.length} ${noun} could not be reached, and ${verb} not audited`,
        ctx.c.yellow,
      ),
    )
  }

  if (completeness.truncated) {
    lines.push(line(ctx, '  The run stopped at its page limit; the site has more', ctx.c.yellow))
  }

  if (lines.length > 0) {
    lines.push(
      line(ctx, '  This report describes what was audited, not the whole site.', ctx.c.dim),
    )
  }

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
    const text = `  none at or above ${failOn} (--fail-on ${failOn}), so this run passes`
    return line(ctx, text, ctx.c.green)
  }

  return line(ctx, `  ${failing} at or above ${failOn} (--fail-on ${failOn})`, ctx.c.red)
}

/**
 * The unevaluated rules are listed once, at the end, rather than repeated under
 * every page: on a large site the same handful recurs on each one, and a wall
 * of "not evaluated" would bury the findings that are real.
 */
function blindSection(audits: readonly PageAudit[], ctx: Context): string[] {
  // Widest reach first: the rule left unevaluated on every page is the one
  // whose gap in coverage is largest.
  const blind = blindRules(audits).sort((a, b) => b.pages - a.pages)
  if (blind.length === 0) return []

  const lines = [
    '',
    line(ctx, 'Not evaluated', ctx.c.bold),
    line(ctx, '  This engine reached no verdict on these.', ctx.c.dim),
    line(ctx, '  They are never reported as passing.', ctx.c.dim),
  ]

  for (const { ruleId, pages, finding } of blind) {
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('blind')} ` },
        { text: ruleId },
        { text: ` ${count(pages, 'page')}${criteria(finding)}`, paint: ctx.c.dim },
      ]),
      line(ctx, `      ${finding.reasonDetail}`, ctx.c.dim),
    )

    // The check somebody does by hand. Without it "could not be evaluated"
    // leaves a reader knowing there is a gap and not what to do about it,
    // which is the half of compliance every tool waves at.
    const manual = manualCheckFor(ruleId)
    if (manual !== undefined && ctx.manual) {
      for (const wrapped of wrap(manual.check, ctx.width - 8)) {
        lines.push(line(ctx, `      ${wrapped}`, ctx.c.dim))
      }
      if (manual.browserAnswers) {
        lines.push(line(ctx, '      or run again with --browser', ctx.c.dim))
      }
    }

    for (const criterion of finding.successCriteria) {
      const url = understandingUrl(criterion)
      if (url !== undefined) lines.push(line(ctx, `      ${criterion}: ${url}`, ctx.c.dim))
    }
  }

  if (!ctx.manual) {
    lines.push(line(ctx, '  Run with --manual for what to check by hand.', ctx.c.dim))
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
  return [...findings].sort(
    (a, b) => impactRank(a.impact) - impactRank(b.impact) || a.ruleId.localeCompare(b.ruleId),
  )
}

function criteria(finding: Finding): string {
  return finding.successCriteria.length > 0 ? `, WCAG ${finding.successCriteria.join(' ')}` : ''
}

/**
 * What is actually broken, once per element rather than once per page.
 *
 * The page-by-page listing above is the truth, and on a site built from
 * components it is not the work: one header with a missing `alt` reappears on
 * every page that renders it, and nothing in a per-page report says those are
 * one line in one file. This section says it, and orders the result by what
 * fixing it would buy.
 */
function issuesSection(audits: readonly PageAudit[], ctx: Context): string[] {
  const issues = groupIssues(audits)
  if (issues.length === 0) return []

  const elements = issues.reduce((total, issue) => total + issue.elements.length, 0)
  const occurrences = issues.reduce((total, issue) => total + issue.occurrences, 0)

  // No leading blank: the caller has already put one after the header.
  const lines = [line(ctx, 'Issues', ctx.c.bold)]

  // Only worth stating when the two numbers differ; on a one-page site they do
  // not, and saying "1 element on 1 page" is noise.
  const intro =
    occurrences === elements
      ? `  ${count(elements, 'distinct element')} to fix.`
      : `  ${count(occurrences, 'violation')} across the site come from ${count(elements, 'distinct element')}.`
  lines.push(line(ctx, intro, ctx.c.dim))

  for (const issue of issues) {
    lines.push('')
    lines.push(
      render(ctx, [
        { text: `  ${ctx.symbol('violation')} ` },
        { text: issue.ruleId, paint: ctx.c.bold },
        { text: ` ${impactLabel(issue.impact)}`, paint: ctx.c.dim },
        ...(issue.successCriteria.length > 0
          ? [{ text: `, WCAG ${issue.successCriteria.join(' ')}`, paint: ctx.c.dim }]
          : []),
      ]),
    )
    lines.push(line(ctx, `      ${issue.help}`, ctx.c.dim))
    lines.push(...remediationLines(issue.ruleId, issue.elements[0]?.html, ctx))

    for (const element of issue.elements.slice(0, ctx.maxNodes)) {
      lines.push(line(ctx, `      ${collapse(element.html)}`))
      lines.push(...whereLines(element, ctx))
    }
    const hidden = issue.elements.length - ctx.maxNodes
    if (hidden > 0) {
      lines.push(line(ctx, `      …and ${count(hidden, 'more element')}`, ctx.c.dim))
    }
  }

  return lines
}

/**
 * What to do about the rule, under the finding rather than in a link.
 *
 * axe-core's help text says what is wrong; this says who it stops and what to
 * change. The corrected line is built from the element that actually failed,
 * because a textbook snippet is a second thing to translate before anybody can
 * use it.
 */
function remediationLines(ruleId: string, html: string | undefined, ctx: Context): string[] {
  const remediation = remediationFor(ruleId, ctx.framework)
  if (remediation === undefined) return []

  const indent = '      '
  const width = ctx.width - indent.length - 2
  const lines = [
    ...wrap(remediation.why, width).map((text) => line(ctx, `${indent}${text}`, ctx.c.dim)),
    ...wrap(`Fix: ${remediation.fix}`, width).map((text) => line(ctx, `${indent}${text}`)),
  ]

  const example = html === undefined ? undefined : remediation.example?.(html)
  if (example !== undefined) {
    lines.push(
      render(ctx, [{ text: `${indent}→ `, paint: ctx.c.green }, { text: collapse(example) }]),
    )
  }
  return lines
}

/** Where one element appears, and what that says about where the fix goes. */
function whereLines(element: IssueElement, ctx: Context): string[] {
  const shown = element.pages.slice(0, ctx.maxNodes)
  const rest = element.pages.length - shown.length

  // Above the page list, because it is where the fix goes. The pages are where
  // the symptom shows.
  const component = ctx.componentFor(element.html)
  const lines =
    component === undefined
      ? []
      : [
          render(ctx, [
            { text: '        written in ', paint: ctx.c.dim },
            { text: componentPath(component) },
          ]),
        ]

  lines.push(line(ctx, `        on ${count(element.pages.length, 'page')}:`, ctx.c.dim))

  // One per line rather than a comma-separated list: with a source file
  // alongside each, the list runs past any terminal and gets truncated exactly
  // where the useful half is.
  for (const page of shown) {
    const source = ctx.sourceFor(page)
    lines.push(
      render(ctx, [
        { text: `          ${page}`, paint: ctx.c.dim },
        ...(source === undefined ? [] : [{ text: `  ${source}`, paint: ctx.c.dim }]),
      ]),
    )
  }
  if (rest > 0) {
    lines.push(line(ctx, `          …and ${count(rest, 'more page')}`, ctx.c.dim))
  }

  // The point of grouping: identical markup on several pages is one component,
  // and saying so turns a list of findings into a single edit.
  if (isShared(element)) {
    lines.push(line(ctx, '        identical on each — likely one shared component', ctx.c.dim))
  }
  return lines
}

/** Wraps a sentence to the terminal, so a paragraph of advice stays readable. */
function wrap(text: string, width: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line === '') line = word
    else if (`${line} ${word}`.length <= width) line = `${line} ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return lines
}
