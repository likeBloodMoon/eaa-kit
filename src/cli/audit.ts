import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import { BuildDirectoryError, collectPages } from '../audit/collect.ts'
import { countAtOrAbove, DEFAULT_FAIL_ON, type ImpactLevel } from '../audit/impact.ts'
import { formatConsoleReport } from '../audit/report/console.ts'
import { buildJsonReport, serialiseJsonReport } from '../audit/report/json.ts'
import { type PageAudit, runJsdomAudit } from '../audit/runners/jsdom.ts'

export const OUTPUT_FORMATS = ['console', 'json'] as const

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value)
}

export interface AuditCommandOptions {
  include?: string[]
  exclude?: string[]
  baseUrl?: string
  /** Lowest impact that fails the run. Defaults to 'serious'. */
  failOn?: ImpactLevel
  /** Per-page timeout handed to the runner. */
  timeoutMs?: number
  /** What to emit. Defaults to the human-readable console report. */
  format?: OutputFormat
  /** Write the report here instead of stdout. Parent directories are created. */
  output?: string
}

export interface AuditCommandResult {
  audits: PageAudit[]
  /**
   * 0 clean, 1 violations at or above the --fail-on threshold, 2 the audit
   * could not run or could not finish.
   */
  exitCode: number
}

/**
 * `eaa-kit audit [dir]`.
 *
 * Writes progress to stderr and the report to stdout, so the report can be
 * piped somewhere without the chatter coming along.
 */
export async function runAuditCommand(
  dir: string,
  options: AuditCommandOptions = {},
): Promise<AuditCommandResult> {
  let pages: Awaited<ReturnType<typeof collectPages>>
  try {
    pages = await collectPages(dir, {
      ...(options.include ? { include: options.include } : {}),
      ...(options.exclude ? { exclude: options.exclude } : {}),
    })
  } catch (cause) {
    if (cause instanceof BuildDirectoryError) {
      process.stderr.write(`${pc.red('error')} ${cause.message}\n`)
      process.stderr.write(
        pc.dim('Point eaa-kit at your build output, e.g. eaa-kit audit ./dist\n'),
      )
      return { audits: [], exitCode: 2 }
    }
    throw cause
  }

  if (pages.length === 0) {
    process.stderr.write(`${pc.yellow('warning')} No HTML files found in ${dir}\n`)
    return { audits: [], exitCode: 2 }
  }

  process.stderr.write(
    pc.dim(`Auditing ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} in ${dir}…\n`),
  )

  const audits = await runJsdomAudit(pages, {
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })

  const failOn = options.failOn ?? DEFAULT_FAIL_ON
  await emit(audits, dir, failOn, options)

  // A page that could not be audited is not a clean page. Exiting 0 here would
  // hand back a pass for markup nothing ever looked at, so it is reported as a
  // failed run rather than as a verdict.
  const unaudited = audits.filter((audit) => audit.error)
  if (unaudited.length > 0) {
    process.stderr.write(
      `${pc.red('error')} ${unaudited.length} of ${audits.length} pages could not be audited\n`,
    )
    return { audits, exitCode: 2 }
  }

  return { audits, exitCode: countAtOrAbove(audits, failOn) > 0 ? 1 : 0 }
}

/**
 * Emit the chosen format, to a file when --output is given and to stdout
 * otherwise. Colour is dropped when writing to a file, since escape codes in a
 * saved report are noise.
 */
async function emit(
  audits: readonly PageAudit[],
  dir: string,
  failOn: ImpactLevel,
  options: AuditCommandOptions,
): Promise<void> {
  const format = options.format ?? 'console'
  const toFile = typeof options.output === 'string'

  const body =
    format === 'json'
      ? serialiseJsonReport(
          buildJsonReport(audits, {
            directory: dir,
            failOn,
            ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          }),
        )
      : `${formatConsoleReport(audits, { dir, failOn, ...(toFile ? { color: false } : {}) })}\n`

  if (!options.output) {
    process.stdout.write(body)
    return
  }

  const target = path.resolve(options.output)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, body, 'utf8')
  process.stderr.write(pc.dim(`Report written to ${options.output}\n`))
}
