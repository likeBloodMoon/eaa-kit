import path from 'node:path'
import { ConfigError, type Country, type StatementLocale } from '../config/define.ts'
import { loadConfig } from '../config/load.ts'
import { StatementError } from '../statement/error.ts'
import { type AuditSummary, readAuditReport } from '../statement/findings.ts'
import { renderStatement } from '../statement/render.ts'
import { count } from '../text.ts'
import { advise, emitDocument, fail, note } from './command.ts'

/** Markdown for a content directory, HTML for dropping straight onto a site. */
export const STATEMENT_FORMATS = ['markdown', 'html'] as const

export type StatementFormat = (typeof STATEMENT_FORMATS)[number]

export interface StatementCommandOptions {
  /** Explicit config path; otherwise the loader searches upwards. */
  config?: string
  cwd?: string
  locale?: StatementLocale
  country?: Country
  /** Path to a report from `eaa-kit audit --format json`. */
  audit?: string
  /** Defaults to the extension of --output, and to markdown without one. */
  format?: StatementFormat
  /** Write the statement here instead of stdout. */
  output?: string
}

export interface StatementCommandResult {
  /** The document that was emitted, in the format that was chosen. */
  document: string
  format: StatementFormat
  /** 0 written, 2 the statement could not be produced. */
  exitCode: number
}

/**
 * `eaa-kit statement`.
 *
 * The document goes to stdout and everything else to stderr, so it can be piped
 * straight into a file or a static site's content directory.
 */
export async function runStatementCommand(
  options: StatementCommandOptions = {},
): Promise<StatementCommandResult> {
  const format = options.format ?? formatFor(options.output)

  try {
    const { config, path: configPath } = await loadConfig({
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.config ? { path: options.config } : {}),
    })

    let audit: AuditSummary | undefined
    if (options.audit) {
      audit = await readAuditReport(options.audit, options.cwd ?? process.cwd())
    }

    const statement = await renderStatement(config, {
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.country ? { country: options.country } : {}),
      ...(audit ? { audit } : {}),
    })

    note(
      `Statement for ${config.site.url} from ${path.basename(configPath)} (${statement.template}, ${format})`,
    )

    if (audit) {
      const from = path.basename(options.audit ?? '')
      note(`${count(audit.findings.length, 'barrier')} taken from ${from}`)
      // The descriptions are axe-core's, in English, and they are published
      // under the provider's name. Saying so once on stderr is cheap; a German
      // legal document full of English rule text that nobody was warned about
      // is not.
      if (audit.findings.length > 0) {
        advise('Rewrite those descriptions in your own words before publishing.')
      }
    }

    const document = format === 'html' ? statement.html : statement.markdown

    await emitDocument(document, options.output, options.cwd ?? process.cwd())
    if (options.output !== undefined) note(`Written to ${options.output}`)

    // The generated text says this too, but someone piping it into a file may
    // never read it, and a legal document is the wrong place to be quiet about
    // what produced it.
    advise('Review before publishing. This is a draft, not legal advice.')

    return { document, format, exitCode: 0 }
  } catch (cause) {
    if (cause instanceof ConfigError || cause instanceof StatementError) {
      fail(cause.message)
      if (cause instanceof ConfigError) {
        for (const issue of cause.issues) note(`  ${issue}`)
      }
      return { document: '', format, exitCode: 2 }
    }
    throw cause
  }
}

/**
 * `--output a11y.html` means HTML. Writing a full HTML document into a file
 * somebody named .html and then having it be markdown would be a worse surprise
 * than ignoring the extension, and `--format` still overrides this.
 */
function formatFor(output: string | undefined): StatementFormat {
  return output && /\.html?$/i.test(output) ? 'html' : 'markdown'
}
