import axe from 'axe-core'
import { escapeAttribute, escapeText } from '../../escape.ts'
import { TOOL_VERSION } from '../../version.ts'
import { countAtOrAbove, type ImpactLevel, isImpactLevel } from '../impact.ts'
import { groupIssues, isShared } from '../issues.ts'
import type { Finding, IncompleteFinding, PageAudit } from '../runners/jsdom.ts'

/**
 * A standalone HTML audit report.
 *
 * The console report is for the person who ran the command; JSON and SARIF are
 * for other programs. This one is for somebody who was not at the terminal —
 * the client whose site it is, or the colleague who has to fix it — so it is a
 * single file that can be attached to an email and opened, with no server, no
 * assets and no scripts.
 *
 * It says exactly what the console report says, in the same order and with the
 * same refusals: the four result categories stay apart, rules this engine could
 * not evaluate are named rather than quietly dropped, and nothing here adds up
 * to a compliance claim. A report with no findings means no findings were
 * found, which is not the same as a site being accessible, and the document
 * says so in its own footer rather than leaving the reader to infer it.
 */

/** Elements listed per rule before the rest are summarised. */
const MAX_NODES = 5

/** Longest element markup shown before it is truncated. */
const MAX_SNIPPET = 200

export interface HtmlReportOptions {
  /** Maps an audited page to the source file that produced it, when known. */
  sourceFor?: (pagePath: string) => string | undefined
  /** Build directory the audit ran against. */
  directory: string
  /** Lowest impact that fails the run. */
  failOn: ImpactLevel
  baseUrl?: string
  /** Injectable so tests and snapshots are not time-dependent. */
  now?: Date
}

export function buildHtmlReport(audits: readonly PageAudit[], options: HtmlReportOptions): string {
  const engine = audits[0]?.engine ?? 'jsdom'
  const failing = countAtOrAbove(audits, options.failOn)
  const generatedAt = (options.now ?? new Date()).toISOString()
  const title = `Accessibility audit · ${options.directory}`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="eaa-kit ${escapeAttribute(TOOL_VERSION)}">
<title>${escapeText(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
<main>
<h1>Accessibility audit</h1>
${verdict(audits, failing, options)}
${scoreboard(audits)}
${issues(audits, options)}
${runDetails(audits, engine, generatedAt, options)}
${summary(audits, failing, options)}
${pages(audits)}
${notEvaluated(audits)}
${footer()}
</main>
</body>
</html>
`
}

/**
 * The result, in words, before any of the detail.
 *
 * Not colour alone: the badge carries the word as well, because a reader who
 * cannot distinguish the two shades still has to be able to read the outcome —
 * which would be an embarrassing thing for this document in particular to get
 * wrong.
 */
function verdict(
  audits: readonly PageAudit[],
  failing: number,
  options: HtmlReportOptions,
): string {
  const unaudited = audits.filter((audit) => audit.error).length

  if (unaudited > 0) {
    return banner(
      'broken',
      'Could not finish',
      `${count(unaudited, 'page')} could not be audited, so this run reached no verdict.`,
    )
  }
  if (failing > 0) {
    return banner(
      'fail',
      'Violations found',
      `${count(failing, 'violation')} at or above ${escapeText(options.failOn)}.`,
    )
  }
  const below = totalViolations(audits) - failing
  if (below > 0) {
    return banner(
      'pass',
      'No violations at the threshold',
      `${count(below, 'violation')} below ${escapeText(options.failOn)}, which do not fail the run.`,
    )
  }
  return banner('pass', 'No violations found', 'Automated testing found nothing to report.')
}

function banner(kind: string, heading: string, detail: string): string {
  return `<p class="verdict ${escapeAttribute(kind)}"><strong>${escapeText(heading)}</strong> ${detail}</p>`
}

function runDetails(
  audits: readonly PageAudit[],
  engine: string,
  generatedAt: string,
  options: HtmlReportOptions,
): string {
  // The engine label has to follow the engine: calling a Chromium run
  // "browserless" is the kind of detail a reader will notice and stop trusting.
  const rows: Array<[string, string]> = [
    ['Directory', options.directory],
    ['Pages', String(audits.length)],
    ['Engine', engine === 'browser' ? 'Chromium' : 'jsdom (browserless)'],
    ['Threshold', `${options.failOn} and above fails the run`],
    ['Generated', generatedAt],
    ['eaa-kit', `${TOOL_VERSION} · axe-core ${axe.version}`],
  ]
  if (options.baseUrl) rows.splice(1, 0, ['Base URL', options.baseUrl])

  const body = rows
    .map(
      ([term, value]) => `  <div><dt>${escapeText(term)}</dt><dd>${escapeText(value)}</dd></div>`,
    )
    .join('\n')

  return `<h2>The run</h2>\n<dl class="run">\n${body}\n</dl>`
}

function summary(
  audits: readonly PageAudit[],
  failing: number,
  options: HtmlReportOptions,
): string {
  const byImpact = new Map<string, number>()
  let needsReview = 0
  let blind = 0
  let passes = 0
  let inapplicable = 0
  let elements = 0
  let accepted = 0

  for (const audit of audits) {
    for (const finding of audit.accepted ?? []) accepted += finding.nodes.length
    for (const finding of audit.violations) {
      const impact =
        finding.impact && isImpactLevel(finding.impact) ? finding.impact : 'unclassified'
      byImpact.set(impact, (byImpact.get(impact) ?? 0) + 1)
      elements += finding.nodes.length
    }
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') blind += 1
      else needsReview += 1
    }
    passes += audit.passes.length
    inapplicable += audit.inapplicable.length
  }

  const impacts = (['critical', 'serious', 'moderate', 'minor', 'unclassified'] as const)
    .filter((impact) => (byImpact.get(impact) ?? 0) > 0)
    .map(
      (impact) =>
        `  <li><span class="badge ${escapeAttribute(impact)}">${escapeText(impact)}</span> ${byImpact.get(impact)}</li>`,
    )
    .join('\n')

  const withViolations = audits.filter((audit) => audit.violations.length > 0).length

  return `<h2>Summary</h2>
<ul class="counts">
  <li><strong>${count(totalViolations(audits), 'violation')}</strong> on ${withViolations} of ${count(audits.length, 'page')}, across ${count(elements, 'element')}</li>
  <li><strong>${failing}</strong> at or above ${escapeText(options.failOn)}</li>
  <li><strong>${needsReview}</strong> ${needsReview === 1 ? 'rule needs' : 'rules need'} manual review</li>
  <li><strong>${blind}</strong> ${blind === 1 ? 'rule was' : 'rules were'} not evaluated by this engine</li>
${accepted > 0 ? `  <li><strong>${accepted}</strong> ${accepted === 1 ? 'element is' : 'elements are'} accepted by the baseline, and not counted above</li>` : ''}
</ul>
${impacts ? `<ul class="impacts">\n${impacts}\n</ul>` : ''}
<p class="note">
  <strong>${passes}</strong> rule results were checked and met, and <strong>${inapplicable}</strong>
  found nothing on the page to check. Those two are counted separately and never added
  together: a rule with nothing to check is not a rule that passed, and a page with no
  images proves nothing about image alternatives.
</p>`
}

function pages(audits: readonly PageAudit[]): string {
  const sections = audits.map(pageSection).join('\n')
  return `<h2>Pages</h2>\n${sections}`
}

function pageSection(audit: PageAudit): string {
  const heading = `<h3 class="page">${escapeText(audit.relativePath)}</h3>`

  if (audit.error) {
    return `${heading}
<p class="verdict broken"><strong>Not audited</strong> ${escapeText(audit.error)}</p>`
  }

  const parts: string[] = [heading]

  if (audit.violations.length === 0) {
    // "No violations" would be a lie on a page whose violations were all
    // accepted by a baseline. They are still there; they just do not fail.
    parts.push(
      (audit.accepted ?? []).length === 0
        ? '<p class="clean">No violations.</p>'
        : '<p class="coverage">No new violations.</p>',
    )
  } else {
    const findings = [...audit.violations].sort(byImpactThenRule).map(violation).join('\n')
    parts.push(`<ol class="findings">\n${findings}\n</ol>`)
  }

  const review = audit.incomplete.filter((finding) => finding.reason === 'needs-review')
  if (review.length > 0) {
    const items = review
      .map(
        (finding) =>
          `  <li><code>${escapeText(finding.ruleId)}</code> needs manual review${standards(finding)}</li>`,
      )
      .join('\n')
    parts.push(`<p class="review-heading">A human has to decide these:</p>\n<ul>\n${items}\n</ul>`)
  }

  const accepted = audit.accepted ?? []
  if (accepted.length > 0) {
    const items = [...accepted]
      .sort(byImpactThenRule)
      .map(
        (finding) =>
          `  <li><code>${escapeText(finding.ruleId)}</code> — ${escapeText(finding.help)} (${count(finding.nodes.length, 'element')})</li>`,
      )
      .join('\n')
    parts.push(
      `<p class="accepted-heading">Accepted by the baseline. Still violations, and not counted above:</p>\n<ul class="accepted">\n${items}\n</ul>`,
    )
  }

  parts.push(coverage(audit))
  return parts.join('\n')
}

function violation(finding: Finding): string {
  const impact = finding.impact && isImpactLevel(finding.impact) ? finding.impact : 'unclassified'
  const shown = finding.nodes.slice(0, MAX_NODES)
  const remaining = finding.nodes.length - shown.length

  const nodes = shown
    .map(
      (node) => `    <li>
      <code class="selector">${escapeText(node.target.join(' '))}</code>
      <pre><code>${escapeText(snippet(node.html))}</code></pre>
    </li>`,
    )
    .join('\n')

  const more =
    remaining > 0 ? `\n    <li class="more">and ${count(remaining, 'more element')}</li>` : ''

  return `  <li class="finding">
    <p class="rule">
      <span class="badge ${escapeAttribute(impact)}">${escapeText(impact)}</span>
      <code>${escapeText(finding.ruleId)}</code>
      <a href="${escapeAttribute(finding.helpUrl)}">${escapeText(finding.help)}</a>
    </p>
    <p class="standards">${standardsText(finding) || 'No mapped success criterion'}</p>
    <ul class="nodes">
${nodes}${more}
    </ul>
  </li>`
}

/**
 * What this page's result rests on.
 *
 * The four counts stay apart for the same reason they do everywhere else: only
 * `passed` is evidence that anything was met here.
 */
function coverage(audit: PageAudit): string {
  const blind = audit.incomplete.filter((finding) => finding.reason === 'engine-limitation').length
  const review = audit.incomplete.length - blind
  const parts = [`${audit.passes.length} passed`, `${audit.inapplicable.length} not applicable`]
  if (review > 0) parts.push(`${review} to review`)
  if (blind > 0) parts.push(`${blind} not evaluated`)

  return `<p class="coverage">${escapeText(parts.join(' · '))}</p>`
}

/**
 * Rules this engine reached no verdict on, listed once at the end.
 *
 * They are never reported as passing, and leaving them out entirely would let
 * the reader take the rest of the document for full coverage.
 */
function notEvaluated(audits: readonly PageAudit[]): string {
  const byRule = new Map<string, { pages: number; detail: string; finding: IncompleteFinding }>()

  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason !== 'engine-limitation') continue
      const existing = byRule.get(finding.ruleId)
      if (existing) existing.pages += 1
      else byRule.set(finding.ruleId, { pages: 1, detail: finding.reasonDetail, finding })
    }
  }

  if (byRule.size === 0) return ''

  const items = [...byRule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([ruleId, entry]) => `  <li>
    <code>${escapeText(ruleId)}</code> on ${count(entry.pages, 'page')}${standards(entry.finding)}
    <span class="reason">${escapeText(entry.detail)}</span>
  </li>`,
    )
    .join('\n')

  return `<h2>Not evaluated</h2>
<p>This engine reached no verdict on these rules. They are never reported as passing.</p>
<ul class="not-evaluated">
${items}
</ul>`
}

function footer(): string {
  return `<hr>
<footer>
  <p>
    Generated with <a href="https://github.com/likeBloodMoon/eaa-kit">eaa-kit</a>. Automated
    testing finds a minority of accessibility barriers: it cannot judge whether alternative
    text is accurate, whether a page makes sense in reading order, or whether a form can
    actually be completed with a screen reader.
  </p>
  <p>
    <strong>A report with no findings is not a compliance statement.</strong> It means
    nothing was found by this engine, which is not the same as a site being accessible.
  </p>
</footer>`
}

function standards(finding: Finding): string {
  const text = standardsText(finding)
  return text ? ` — ${text}` : ''
}

function standardsText(finding: Finding): string {
  const parts = [
    ...finding.successCriteria.map((criterion) => `WCAG ${criterion}`),
    ...finding.enClauses.map((clause) => `EN 301 549 ${clause}`),
  ]
  return escapeText(parts.join(', '))
}

/** Element markup, on one line and bounded, so one minified page cannot fill the report. */
function snippet(html: string): string {
  const collapsed = html.replace(/\s+/g, ' ').trim()
  return collapsed.length > MAX_SNIPPET ? `${collapsed.slice(0, MAX_SNIPPET - 1)}…` : collapsed
}

function totalViolations(audits: readonly PageAudit[]): number {
  return audits.reduce((total, audit) => total + audit.violations.length, 0)
}

function byImpactThenRule(a: Finding, b: Finding): number {
  const order = ['critical', 'serious', 'moderate', 'minor']
  const rank = (finding: Finding): number => {
    const index = finding.impact ? order.indexOf(finding.impact) : -1
    // Unclassified sorts with the most severe, on the same reasoning as
    // --fail-on: not knowing how bad something is is not evidence it is mild.
    return index === -1 ? -1 : index
  }
  const difference = rank(a) - rank(b)
  return difference === 0 ? a.ruleId.localeCompare(b.ruleId) : difference
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

const STYLES = `:root { color-scheme: light dark; }
body { margin: 0; background: #ffffff; color: #1a1a1a;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
main { max-width: 60rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.25; margin: 0 0 1rem; }
h2 { font-size: 1.35rem; margin: 2.5rem 0 0.75rem; padding-top: 1.5rem;
  border-top: 1px solid #d4d4d4; }
h3.page { font-size: 1.05rem; margin: 2rem 0 0.5rem; font-family: ui-monospace, monospace; }
p { margin: 0 0 1rem; }
a { color: #0b4fa8; }
a:focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
pre { margin: 0.4rem 0 0; padding: 0.6rem 0.75rem; overflow-x: auto;
  background: #f4f4f5; border-radius: 4px; }
pre code { font-size: 0.85em; }
ul, ol { margin: 0 0 1rem; padding-left: 1.25rem; }
li + li { margin-top: 0.5rem; }
.verdict { padding: 0.75rem 1rem; border-radius: 4px; border-left: 4px solid; }
.verdict.pass { background: #eef7ee; border-color: #216e39; }
.verdict.fail { background: #fdeeee; border-color: #a01b1b; }
.verdict.broken { background: #fdf4e3; border-color: #8a5a00; }
.badge { display: inline-block; padding: 0 0.45rem; border-radius: 3px; font-size: 0.8rem;
  font-weight: 600; border: 1px solid; }
.badge.critical { background: #fdeeee; border-color: #a01b1b; color: #7a1414; }
.badge.serious { background: #fdf1e8; border-color: #a4531b; color: #7d3f14; }
.badge.moderate { background: #fdf9e3; border-color: #7a6100; color: #5c4900; }
.badge.minor { background: #eef2f8; border-color: #40556f; color: #33455a; }
.badge.unclassified { background: #f1f1f1; border-color: #565656; color: #444444; }
dl.run { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1.5rem; margin: 0; }
dl.run > div { display: contents; }
dl.run dt { font-weight: 600; }
dl.run dd { margin: 0; }
ul.counts, ul.impacts { list-style: none; padding-left: 0; }
ul.impacts li { display: inline-block; margin-right: 1rem; }
ol.findings { list-style: none; padding-left: 0; }
li.finding { margin: 0 0 1.5rem; padding-left: 0.9rem; border-left: 3px solid #d4d4d4; }
p.rule { margin-bottom: 0.25rem; }
p.standards, p.coverage, .reason, li.more, p.accepted-heading, ul.accepted { color: #4a4a4a; font-size: 0.9rem; }
p.coverage { margin-top: 0.5rem; }
ul.nodes { list-style: none; padding-left: 0; }
code.selector { color: #4a4a4a; }
p.clean { color: #216e39; }
p.note { font-size: 0.95rem; }
hr { border: 0; border-top: 1px solid #d4d4d4; margin: 3rem 0 1.5rem; }
footer { color: #4a4a4a; font-size: 0.9rem; }
.scoreboard { list-style: none; display: flex; flex-wrap: wrap; gap: 0.75rem;
  padding: 0; margin: 1.25rem 0 2rem; }
.tile { flex: 1 1 8rem; padding: 0.75rem 1rem; border: 1px solid; border-radius: 6px; }
.tile .figure { display: block; font-size: 1.75rem; font-weight: 700; line-height: 1.1; }
.tile .label { font-size: 0.85rem; }
.tile.critical { background: #fdeeee; border-color: #a01b1b; color: #7a1414; }
.tile.serious { background: #fdf1e8; border-color: #a4531b; color: #7d3f14; }
.tile.moderate { background: #fdf9e3; border-color: #7a6100; color: #5c4900; }
.tile.minor { background: #eef2f8; border-color: #40556f; color: #33455a; }
.tile.unclassified { background: #f1f1f1; border-color: #565656; color: #444444; }
.tile.none { background: #eef7ee; border-color: #216e39; color: #17512a; }
.tile.unchecked { background: #f4f4f5; border-color: #565656; color: #444444; }
p.intro { color: #4a4a4a; }
ol.issues { list-style: none; padding: 0; }
li.issue { border: 1px solid #d7d7d7; border-radius: 6px; padding: 0.75rem 1rem;
  margin: 0 0 1rem; }
li.issue h3 { margin: 0 0 0.25rem; font-size: 1rem; display: flex; flex-wrap: wrap;
  gap: 0.5rem; align-items: baseline; }
li.issue .wcag { color: #4a4a4a; font-size: 0.85rem; font-weight: 400; }
p.help { margin: 0 0 0.75rem; }
.element { border-top: 1px solid #e6e6e6; padding-top: 0.75rem; margin-top: 0.75rem; }
.element:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }
p.reach, p.sources, p.selector, p.more { margin: 0.35rem 0; font-size: 0.9rem; color: #4a4a4a; }
.element details { font-size: 0.9rem; color: #4a4a4a; }
.element summary { cursor: pointer; }
ul.page-list { margin: 0.35rem 0 0; padding-left: 1.25rem; }
@media (prefers-color-scheme: dark) {
  body { background: #121212; color: #ededed; }
  a { color: #9ec1ff; }
  h2, hr { border-color: #3a3a3a; }
  pre { background: #1e1e1e; }
  li.finding { border-color: #3a3a3a; }
  p.standards, p.coverage, .reason, li.more, code.selector, footer,
  p.accepted-heading, ul.accepted { color: #b6b6b6; }
  p.clean { color: #7ee2a8; }
  .verdict.pass { background: #10240f; border-color: #7ee2a8; }
  .verdict.fail { background: #2b1111; border-color: #ff9d9d; }
  .verdict.broken { background: #2b2310; border-color: #ffd28a; }
  .tile.critical { background: #2b1111; border-color: #ff9d9d; color: #ffc9c9; }
  .tile.serious { background: #2b1d11; border-color: #ffb98a; color: #ffd7bd; }
  .tile.moderate { background: #2b2610; border-color: #f0d264; color: #f5e3a4; }
  .tile.minor { background: #161c25; border-color: #9db6d6; color: #c6d6ea; }
  .tile.unclassified { background: #1f1f1f; border-color: #9a9a9a; color: #d0d0d0; }
  .tile.none { background: #10240f; border-color: #7ee2a8; color: #b6f0cd; }
  .tile.unchecked { background: #1e1e1e; border-color: #9a9a9a; color: #d0d0d0; }
  p.intro, li.issue .wcag, p.reach, p.sources, p.selector, .element details { color: #b6b6b6; }
  li.issue { border-color: #3a3a3a; }
  .element { border-top-color: #2e2e2e; }
  .badge.critical { background: #2b1111; border-color: #ff9d9d; color: #ffc9c9; }
  .badge.serious { background: #2b1c11; border-color: #ffbb8a; color: #ffd9bd; }
  .badge.moderate { background: #262110; border-color: #ffe08a; color: #ffeec2; }
  .badge.minor { background: #16202b; border-color: #a8c6e8; color: #cfdff0; }
  .badge.unclassified { background: #1f1f1f; border-color: #b6b6b6; color: #d8d8d8; }
}
@media print {
  body { background: #ffffff; color: #000000; }
  main { max-width: none; }
  a { color: #000000; }
}`

/**
 * The counts, worst first, with what was never checked beside them.
 *
 * A row of severity totals is the first thing anybody reads, and on its own it
 * is the one place this document could mislead: a client seeing "0 critical, 0
 * serious" concludes the site is fine, when the honest reading of that same run
 * may be that six whole rule categories could not be evaluated at all. So the
 * unevaluated count sits in the same row, in the same type size, rather than in
 * a section further down that nobody scrolls to.
 */
function scoreboard(audits: readonly PageAudit[]): string {
  const issueList = groupIssues(audits)
  const counted = new Map<string, number>()
  for (const issue of issueList) {
    const key = issue.impact ?? 'unclassified'
    counted.set(key, (counted.get(key) ?? 0) + issue.occurrences)
  }

  const blind = new Set<string>()
  for (const audit of audits) {
    for (const finding of audit.incomplete) {
      if (finding.reason === 'engine-limitation') blind.add(finding.ruleId)
    }
  }

  // Only the levels that occurred, so a clean run is not a row of zeroes
  // implying the tool went looking for things it did not find.
  const order = ['critical', 'serious', 'moderate', 'minor', 'unclassified'] as const
  const tiles = order
    .filter((level) => (counted.get(level) ?? 0) > 0)
    .map(
      (level) =>
        `<li class="tile ${level}"><span class="figure">${counted.get(level)}</span> <span class="label">${level}</span></li>`,
    )

  if (tiles.length === 0) {
    tiles.push(
      '<li class="tile none"><span class="figure">0</span> <span class="label">violations</span></li>',
    )
  }

  if (blind.size > 0) {
    tiles.push(
      `<li class="tile unchecked"><span class="figure">${blind.size}</span> <span class="label">not evaluated</span></li>`,
    )
  }

  return `<ul class="scoreboard">\n${tiles.join('\n')}\n</ul>`
}

/**
 * What is broken, once per element rather than once per page.
 *
 * The page-by-page listing further down is the same information keyed the other
 * way round. It is the right shape for working through one page and the wrong
 * shape for deciding what to do: on a site built from components one broken
 * header is one line in one file, and a per-page listing reports it as many
 * findings without ever saying they are the same defect.
 */
function issues(audits: readonly PageAudit[], options: HtmlReportOptions): string {
  const found = groupIssues(audits)
  if (found.length === 0) return ''

  const elements = found.reduce((total, issue) => total + issue.elements.length, 0)
  const occurrences = found.reduce((total, issue) => total + issue.occurrences, 0)

  const intro =
    occurrences === elements
      ? `${count(elements, 'distinct element')} to fix.`
      : `${count(occurrences, 'violation')} across the site, from ${count(elements, 'distinct element')}.`

  return `<h2 id="issues">What to fix</h2>
<p class="intro">${escapeText(intro)}</p>
<ol class="issues">
${found.map((issue) => issueSection(issue, options)).join('\n')}
</ol>`
}

function issueSection(
  issue: ReturnType<typeof groupIssues>[number],
  options: HtmlReportOptions,
): string {
  const impact = issue.impact ?? 'unclassified'
  const criteria =
    issue.successCriteria.length > 0
      ? `<span class="wcag">WCAG ${escapeText(issue.successCriteria.join(' '))}</span>`
      : ''

  return `<li class="issue">
<h3><span class="badge ${impact}">${impact}</span> <code>${escapeText(issue.ruleId)}</code> ${criteria}</h3>
<p class="help">${escapeText(issue.help)}</p>
${issue.elements
  .slice(0, MAX_NODES)
  .map((element) => issueElement(element, options))
  .join('\n')}
${
  issue.elements.length > MAX_NODES
    ? `<p class="more">…and ${count(issue.elements.length - MAX_NODES, 'more element')}</p>`
    : ''
}
</li>`
}

function issueElement(
  element: ReturnType<typeof groupIssues>[number]['elements'][number],
  options: HtmlReportOptions,
): string {
  const sources = [
    ...new Set(
      element.pages
        .map((page) => options.sourceFor?.(page))
        .filter((source): source is string => source !== undefined),
    ),
  ]

  // The pages fold away because on a large site one element can appear on
  // hundreds, and the list is reference rather than the point. What it says
  // about the fix — one component, these files — stays open.
  const list = element.pages.map((page) => `<li>${escapeText(page)}</li>`).join('')

  return `<div class="element">
<pre><code>${escapeText(collapseWhitespace(element.html))}</code></pre>
${element.selector === '' ? '' : `<p class="selector"><code>${escapeText(element.selector)}</code></p>`}
<p class="reach">Found on ${count(element.pages.length, 'page')}.${
    isShared(element) ? ' <strong>Identical on each — likely one shared component.</strong>' : ''
  }</p>
${
  sources.length > 0
    ? `<p class="sources">Source: ${sources.map((source) => `<code>${escapeText(source)}</code>`).join(', ')}</p>`
    : ''
}
<details><summary>${count(element.pages.length, 'page')}</summary><ul class="page-list">${list}</ul></details>
</div>`
}

/** Long markup is unreadable in a report; the identifying part is the start. */
function collapseWhitespace(html: string): string {
  const flat = html.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat
}
