import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Country, EaaConfig, KnownIssue, StatementLocale } from '../config/define.ts'
import { renderTemplate, type TemplateScope } from './template.ts'

export interface RenderStatementOptions {
  /** Language to render in. Defaults to the site's own language when it is German. */
  locale?: StatementLocale
  /** Overrides the country from the config, for previewing another template. */
  country?: Country
}

export class StatementError extends Error {
  override readonly name = 'StatementError'
}

export interface RenderedStatement {
  markdown: string
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
  const markdown = renderTemplate(source, buildScope(config, locale))

  return { markdown: tidy(markdown), locale, country, template }
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
function buildScope(config: EaaConfig, locale: StatementLocale): TemplateScope {
  const issues = config.compliance.knownIssues.map((issue) => toIssueScope(issue, locale))

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
    hasKnownIssues: issues.length > 0,
    hasNoKnownIssues: issues.length === 0,
  }
}

function toIssueScope(issue: KnownIssue, locale: StatementLocale): TemplateScope {
  const references = [
    ...issue.successCriteria.map((criterion) => `WCAG ${criterion}`),
    ...issue.en301549.map((clause) => `EN 301 549 ${clause}`),
  ]

  return {
    description: issue.description,
    standards: references.join(', '),
    isDisproportionateBurden: issue.reason === 'disproportionate-burden',
    isOutOfScope: issue.reason === 'out-of-scope',
    isFixPlanned: issue.reason === 'fix-planned',
    remedyByFormatted: issue.remedyBy ? formatDate(issue.remedyBy, locale) : '',
  }
}

/** 2026-08-20 becomes 20. August 2026 or 20 August 2026. */
function formatDate(iso: string, locale: StatementLocale): string {
  const date = new Date(`${iso}T00:00:00Z`)
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
    try {
      if ((await stat(candidate)).isDirectory()) return candidate
    } catch {
      // try the next one
    }
  }

  throw new StatementError(
    `Could not locate the statement templates. Looked in: ${candidates.join(', ')}`,
  )
}
