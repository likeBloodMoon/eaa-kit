import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WCAG22_AA_CRITERIA } from '../audit/criteria.ts'
import type { ReviewRecord } from '../audit/review.ts'
import {
  type Country,
  type EaaConfig,
  type KnownIssue,
  STATEMENT_LOCALES,
  type StatementLocale,
} from '../config/define.ts'
import { isDirectory } from '../fs.ts'
import { standardsReference } from '../text.ts'
import { StatementError } from './error.ts'
import type { AuditFinding, AuditSummary } from './findings.ts'
import { toHtmlDocument } from './html.ts'
import { renderTemplate, type TemplateScope } from './template.ts'

export { StatementError } from './error.ts'

/** How many affected pages a barrier lists before it starts counting instead. */
const MAX_LISTED_PAGES = 5

export interface RenderStatementOptions {
  /** Language to render in. Defaults to the site's own language when it is German. */
  locale?: StatementLocale
  /** Overrides the country from the config, for previewing another template. */
  country?: Country
  /**
   * Findings from `eaa-kit audit --format json`, appended to the barriers the
   * config lists. Left out, the statement says only what the config says.
   */
  audit?: AuditSummary
  /**
   * What a person checked, from `eaa-kit checklist`.
   *
   * Reaches the document as one fact — how many of WCAG's success criteria were
   * checked by hand, and when — and never as a verdict. What a review concluded
   * about a criterion is a claim by a person, and the place for a claim in a
   * statement is the barrier list, which a person writes.
   */
  review?: ReviewRecord
}

export interface RenderedStatement {
  markdown: string
  /** The same document as a standalone HTML page. */
  html: string
  locale: StatementLocale
  country: Country
  /** Template the text came from, e.g. 'at.de'. */
  template: string
}

/**
 * Render an accessibility statement from a validated config.
 *
 * All prose lives in the templates. This function only decides which template
 * to load and prepares the values it interpolates, including the booleans the
 * template branches on, so that no German sentence is assembled in TypeScript.
 */
export async function renderStatement(
  config: EaaConfig,
  options: RenderStatementOptions = {},
): Promise<RenderedStatement> {
  const country = options.country ?? config.enforcement.country
  const locale = options.locale ?? defaultLocale(config)
  const template = `${country.toLowerCase()}.${locale}`

  const source = await loadTemplate(country, locale)
  const markdown = tidy(renderTemplate(source, buildScope(config, locale, options)))
  const html = toHtmlDocument(markdown, { lang: locale, fallbackTitle: config.site.name })

  return { markdown, html, locale, country, template }
}

/**
 * A site gets its statement in its own language where there is one for it.
 *
 * From `site.locale`, which is a BCP 47 tag: `de-AT` and `de` both mean the
 * German document. English is the fallback because every country has an English
 * template, being the language a statement is most often also published in.
 */
function defaultLocale(config: EaaConfig): StatementLocale {
  const language = config.site.locale.toLowerCase().split('-')[0]
  return STATEMENT_LOCALES.find((candidate) => candidate === language) ?? 'en'
}

/**
 * Values the templates interpolate.
 *
 * Enum-shaped fields become booleans here rather than being compared inside the
 * template, which keeps the template language trivial and puts the mapping
 * somewhere that can be typechecked.
 */
function buildScope(
  config: EaaConfig,
  locale: StatementLocale,
  options: RenderStatementOptions,
): TemplateScope {
  const audit = options.audit
  const review = options.review ? toReviewScope(options.review, locale) : undefined
  // Configured barriers come first: they are written by a human, in the
  // statement's own language, and are the ones a reader should meet first.
  const issues = [
    ...config.compliance.knownIssues.map((issue) => toIssueScope(issue, locale)),
    ...(audit?.findings ?? []).map((finding) =>
      toFindingScope(finding, config.compliance.auditReason),
    ),
  ]

  return {
    site: { ...config.site },
    provider: { ...config.provider },
    compliance: {
      standard: config.compliance.standard,
      knownIssues: issues,
      assessedOnFormatted: formatDate(config.compliance.assessedOn, locale),
      isCompliant: config.compliance.status === 'compliant',
      isPartiallyCompliant: config.compliance.status === 'partially-compliant',
      isNonCompliant: config.compliance.status === 'non-compliant',
      isSelfAssessment: config.compliance.assessmentMethod === 'self-assessment',
      isExternalAudit: config.compliance.assessmentMethod === 'external-audit',
    },
    audit: audit ? toAuditScope(audit, locale) : undefined,
    hasAudit: audit !== undefined,
    review,
    // A record exists and nobody has answered anything in it yet is the ordinary
    // state right after `eaa-kit checklist`, and it is not a review. Generating
    // the worksheet is not doing the work, which is the same refusal the audit
    // report makes when it declines to count `unreviewed`.
    hasReview: review !== undefined,
    hasKnownIssues: issues.length > 0,
    hasNoKnownIssues: issues.length === 0,
  }
}

/**
 * What the automated run itself contributes to the "preparation" section.
 *
 * The counts are here because leaving them out would let a reader take the
 * barrier list for the whole picture. A rule the engine could not evaluate was
 * not checked, and saying so is the same commitment the audit report makes.
 */
function toAuditScope(audit: AuditSummary, locale: StatementLocale): TemplateScope {
  return {
    pages: audit.pages,
    isSinglePage: audit.pages === 1,
    isMultiPage: audit.pages > 1,
    needsReview: audit.needsReview,
    // Singular and plural are separate template branches rather than a count
    // pasted into one sentence: "1 Regelprüfungen" is wrong in German and
    // "1 rule checks" is wrong in English, and neither belongs in a document
    // somebody publishes under their own name.
    needsReviewIsSingle: audit.needsReview === 1,
    needsReviewIsPlural: audit.needsReview > 1,
    notEvaluated: audit.notEvaluated,
    notEvaluatedIsSingle: audit.notEvaluated === 1,
    notEvaluatedIsPlural: audit.notEvaluated > 1,
    checkedOnFormatted: formatDate(audit.generatedAt.slice(0, 10), locale),
  }
}

/**
 * What a person's review contributes to the "preparation" section.
 *
 * One fact: how many of WCAG 2.2's success criteria at A and AA somebody
 * checked by hand, and the last day one of those checks was recorded. It is
 * there because the automated sentences beside it describe a run that cannot
 * reach 34 of those 55 criteria, and a reader with no way to tell an unchecked
 * criterion from an unchecked-by-machine one is being told less than the truth.
 *
 * What it never says is what the review concluded. A recorded result is a claim
 * by a person, and the place for a claim in this document is the barrier list,
 * where a person writes it in their own words. Turning `not-met` into a
 * conformance sentence here would be this tool putting a legal position in
 * somebody's mouth.
 *
 * Returns undefined for a record nobody has answered yet — the ordinary state
 * of the file `eaa-kit checklist` has just written. Generating a worksheet is
 * not doing the review, and the audit report refuses to count it for the same
 * reason.
 */
function toReviewScope(record: ReviewRecord, locale: StatementLocale): TemplateScope | undefined {
  const answered = Object.values(record.criteria).filter((entry) => entry.result !== 'unreviewed')
  if (answered.length === 0) return undefined

  // ISO dates sort lexicographically, which is the one thing this format is
  // for. An entry with no date contributes nothing to "when": it cannot be
  // shown to have happened at any particular time, which is why an undated
  // entry does not count towards `--review-max-age` either.
  const dates = answered.map((entry) => entry.reviewedOn).filter((on) => on !== undefined)
  const latest = dates.sort().at(-1)

  return {
    answered: answered.length,
    total: WCAG22_AA_CRITERIA.length,
    // Singular and plural as separate branches, for the reason the audit scope
    // has them: no template should have to build a number into a sentence.
    isSingle: answered.length === 1,
    isPlural: answered.length > 1,
    hasDate: latest !== undefined,
    checkedOnFormatted: latest === undefined ? '' : formatDate(latest, locale),
  }
}

function toIssueScope(issue: KnownIssue, locale: StatementLocale): TemplateScope {
  return {
    ...reasonScope(issue.reason),
    description: issue.description,
    standards: standardsReference(issue.successCriteria, issue.en301549),
    remedyByFormatted: issue.remedyBy ? formatDate(issue.remedyBy, locale) : '',
    // Every key a barrier can carry is set on every barrier, including the ones
    // only an audit finding has. A missing key would fall through to the outer
    // scope during lookup, and a configured barrier would inherit whatever the
    // document happened to have under that name.
    isFromAudit: false,
    ruleId: '',
    pageList: '',
    morePages: 0,
    hasMorePages: false,
  }
}

/**
 * An audit finding as a barrier.
 *
 * `description` is axe-core's help text, which is English however the statement
 * is written, so the templates mark it as the tool's words rather than the
 * provider's and tell the reader to replace it. Generating German legal prose
 * from an English rule description is not something to do behind someone's
 * back, and a statement is published under their name, not ours.
 */
function toFindingScope(finding: AuditFinding, reason: KnownIssue['reason']): TemplateScope {
  const listed = finding.pages.slice(0, MAX_LISTED_PAGES)
  const remaining = finding.pages.length - listed.length

  return {
    ...reasonScope(reason),
    description: finding.help,
    standards: standardsReference(finding.successCriteria, finding.en301549),
    remedyByFormatted: '',
    isFromAudit: true,
    ruleId: finding.ruleId,
    pageList: listed.join(', '),
    morePages: remaining,
    hasMorePages: remaining > 0,
  }
}

/** Enum to booleans, so no template has to compare strings. */
function reasonScope(reason: KnownIssue['reason']): TemplateScope {
  return {
    isDisproportionateBurden: reason === 'disproportionate-burden',
    isOutOfScope: reason === 'out-of-scope',
    isFixPlanned: reason === 'fix-planned',
  }
}

/**
 * Where each statement language formats its dates.
 *
 * A region is named for every one, because a bare language tag leaves the
 * format to whatever ICU picks: `de` is de-DE, and this tool's German documents
 * have always been dated the Austrian way. `en-GB` for the same reason —
 * 20 August 2026, not August 20, 2026, in a European legal document.
 */
const DATE_LOCALES: Record<StatementLocale, string> = {
  de: 'de-AT',
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  nl: 'nl-NL',
}

/**
 * 2026-08-20 becomes 20. August 2026 or 20 August 2026.
 *
 * Every date reaching this has been through a schema that checks it, so the
 * fallback should be unreachable. It is here because the alternative to
 * returning the string unchanged is Intl throwing a RangeError from inside a
 * document generator, and a statement that comes out with an odd-looking date
 * is recoverable in a way that a stack trace is not.
 */
function formatDate(iso: string, locale: StatementLocale): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso

  return new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

/**
 * Block tags sit on their own lines in the templates, which leaves blank lines
 * behind once they are removed. Collapse runs of them so the markdown does not
 * come out full of gaps.
 */
function tidy(markdown: string): string {
  return `${markdown
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

let templateDirectory: string | undefined

/**
 * The document for a country in a language, if there is one.
 *
 * The matrix is deliberately sparse: a country's statement is written under its
 * own law and published in the language the law is administered in, plus
 * English. Asking for a combination nobody wrote is an error naming the
 * languages that country does have — not a fall back to another language, which
 * would hand somebody a document in a language their readers may not have and
 * do it quietly.
 */
async function loadTemplate(country: Country, locale: StatementLocale): Promise<string> {
  templateDirectory ??= await findTemplateDirectory()
  const directory = templateDirectory
  const name = `${country.toLowerCase()}.${locale}`
  const file = path.join(directory, `${name}.md`)

  try {
    return await readFile(file, 'utf8')
  } catch {
    const templates = (await readdir(directory))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => entry.replace(/\.md$/, ''))
      .sort()
    const prefix = `${country.toLowerCase()}.`
    const forCountry = templates
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))

    throw new StatementError(
      forCountry.length > 0
        ? `No ${country} statement in ${locale}. ${country} has: ${forCountry.join(', ')}`
        : `No statement template for ${name}. Available: ${templates.join(', ')}`,
    )
  }
}

/**
 * Templates ship as files rather than being inlined, so they have to be found
 * at runtime. The layout differs between running from source and running the
 * bundle, where every module collapses into dist/cli/index.js, so the
 * candidates are tried in order rather than assuming one.
 */
async function findTemplateDirectory(): Promise<string> {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const candidates = [
    path.join(here, 'templates'), // src/statement/ during development
    path.join(here, '..', 'statement', 'templates'), // dist/cli/ after bundling
    path.join(here, 'statement', 'templates'), // dist/ if the layout changes
  ]

  for (const candidate of candidates) {
    if (await isDirectory(candidate)) return candidate
  }

  throw new StatementError(
    `Could not locate the statement templates. Looked in: ${candidates.join(', ')}`,
  )
}
