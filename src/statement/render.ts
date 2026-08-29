import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Country, EaaConfig, KnownIssue, StatementLocale } from '../config/define.ts'
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

  const source = await loadTemplate(template)
  const markdown = tidy(renderTemplate(source, buildScope(config, locale, options.audit)))
  const html = toHtmlDocument(markdown, { lang: locale, fallbackTitle: config.site.name })

  return { markdown, html, locale, country, template }
}

/** A German-language site gets a German statement unless told otherwise. */
function defaultLocale(config: EaaConfig): StatementLocale {
  return config.site.locale.toLowerCase().startsWith('de') ? 'de' : 'en'
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
  audit: AuditSummary | undefined,
): TemplateScope {
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

  return new Intl.DateTimeFormat(locale === 'de' ? 'de-AT' : 'en-GB', {
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

async function loadTemplate(name: string): Promise<string> {
  templateDirectory ??= await findTemplateDirectory()
  const directory = templateDirectory
  const file = path.join(directory, `${name}.md`)

  try {
    return await readFile(file, 'utf8')
  } catch {
    const available = (await readdir(directory))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => entry.replace(/\.md$/, ''))
      .sort()
    throw new StatementError(
      `No statement template for ${name}. Available: ${available.join(', ')}`,
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
