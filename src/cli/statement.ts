import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { ConfigError, type Country, type StatementLocale } from '../config/define.ts'
import { loadConfig } from '../config/load.ts'
import { renderStatement, StatementError } from '../statement/render.ts'

export interface StatementCommandOptions {
  /** Explicit config path; otherwise the loader searches upwards. */
  config?: string
  cwd?: string
  locale?: StatementLocale
  country?: Country
  /** Write the statement here instead of stdout. */
  output?: string
}

export interface StatementCommandResult {
  markdown: string
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
  try {
    const { config, path: configPath } = await loadConfig({
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.config ? { path: options.config } : {}),
    })

    const statement = await renderStatement(config, {
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.country ? { country: options.country } : {}),
    })

    process.stderr.write(
      pc.dim(
        `Statement for ${config.site.url} from ${path.basename(configPath)} (${statement.template})\n`,
      ),
    )

    if (options.output) {
      const target = path.resolve(options.cwd ?? process.cwd(), options.output)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, statement.markdown, 'utf8')
      process.stderr.write(pc.dim(`Written to ${options.output}\n`))
    } else {
      process.stdout.write(statement.markdown)
    }

    // The generated text says this too, but someone piping it into a file may
    // never read it, and a legal document is the wrong place to be quiet about
    // what produced it.
    process.stderr.write(
      pc.yellow('Review before publishing. This is a draft, not legal advice.\n'),
    )

    return { markdown: statement.markdown, exitCode: 0 }
  } catch (cause) {
    if (cause instanceof ConfigError || cause instanceof StatementError) {
      process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
      if (cause instanceof ConfigError) {
        for (const issue of cause.issues) {
          process.stderr.write(pc.dim(`  ${issue}\n`))
        }
      }
      return { markdown: '', exitCode: 2 }
    }
    throw cause
  }
}
