import pc from 'picocolors'
import { BuildDirectoryError, collectPages } from '../audit/collect.ts'
import { formatConsoleReport } from '../audit/report/console.ts'
import { type PageAudit, runJsdomAudit } from '../audit/runners/jsdom.ts'

export interface AuditCommandOptions {
  include?: string[]
  exclude?: string[]
  baseUrl?: string
}

export interface AuditCommandResult {
  audits: PageAudit[]
  /** 0 clean, 1 violations found, 2 the audit could not run. */
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
  })

  process.stdout.write(`${formatConsoleReport(audits, { dir })}\n`)

  const hasViolations = audits.some((audit) => audit.violations.length > 0)
  const hasErrors = audits.some((audit) => audit.error)
  return { audits, exitCode: hasViolations || hasErrors ? 1 : 0 }
}
