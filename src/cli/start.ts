import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pc from 'picocolors'
import { DEFAULT_BASELINE_FILE } from '../audit/baseline.ts'
import { COUNTRY_INFO, countryForLocale } from '../config/countries.ts'
import { runAuditCommand } from './audit.ts'
import { auditDefaults, auditInvocation, fail } from './command.ts'

/**
 * `eaa-kit`, with nothing after it.
 *
 * The first thing anybody types is the name of the tool, and until 0.8 that
 * printed the help and exited 2. This makes that first command do the useful
 * thing instead. It finds the site the way `audit` does: an existing build, the
 * project's own build, its server, or a folder of hand-written HTML. It audits
 * the site, writes the HTML report where it can be opened, and then says what it
 * found about the project and which command to run next, based on what the
 * project already has.
 *
 * Nothing is asked and nothing is written into the project except under
 * `.eaa-kit/`, which the run's own cache already uses. A first look should be
 * safe to take on somebody else's checkout.
 */

/** Where the first run leaves the report, relative to the project. */
export const FIRST_RUN_REPORT = path.join('.eaa-kit', 'report.html')

export interface FirstRunOptions {
  cwd?: string
}

export async function runFirstRun(options: FirstRunOptions = {}): Promise<{ exitCode: number }> {
  const cwd = options.cwd ?? process.cwd()
  process.stderr.write(
    `${pc.bold('eaa-kit')} ${pc.dim('· WCAG 2.2 AA · nothing to set up, finding your site…')}\n\n`,
  )

  // A project that has written its defaults down gets them here too: the first
  // run is the same audit as `eaa-kit audit`, with a report written beside it.
  const defaults = await auditDefaults({ cwd })
  const invocation = auditInvocation(undefined, defaults, {})

  const result = await runAuditCommand(invocation.dir, {
    ...invocation.options,
    cwd,
    htmlReport: FIRST_RUN_REPORT,
  })

  if (result.audits.length === 0) {
    // Detection has already said what it tried and how to point the tool at
    // the site by hand. Repeating it would bury that under a second copy.
    fail('No site found to audit, so no report was written.')
    return { exitCode: result.exitCode }
  }

  // After the run, not before: a folder with no site in it is left exactly as
  // it was found.
  await ensureToolDirectory(cwd)
  process.stderr.write(await summary(cwd, result))
  return { exitCode: result.exitCode }
}

/**
 * `.eaa-kit/`, with a `.gitignore` that keeps everything in it out of version
 * control.
 *
 * The docs have always said the directory belongs in `.gitignore`, which is
 * advice nobody running the tool for the first time has read. The first run is
 * about to put a report there as well as the cache. So it looks after that
 * itself, without touching the project's own `.gitignore`.
 */
async function ensureToolDirectory(cwd: string): Promise<void> {
  const directory = path.join(cwd, '.eaa-kit')
  const ignore = path.join(directory, '.gitignore')
  try {
    await mkdir(directory, { recursive: true })
    if (!(await exists(ignore))) {
      await writeFile(ignore, '# Written by eaa-kit: the cache and reports are not source.\n*\n')
    }
  } catch {
    // A read-only checkout still got its audit; there is nothing to protect.
  }
}

async function summary(
  cwd: string,
  result: Awaited<ReturnType<typeof runAuditCommand>>,
): Promise<string> {
  const lines: string[] = ['', pc.bold('What eaa-kit found about this project')]

  const where =
    result.directory === undefined
      ? 'a running server'
      : path.relative(cwd, result.directory) === ''
        ? 'this folder'
        : `${path.relative(cwd, result.directory)}${path.sep}`
  const { detectFramework } = await import('../audit/frameworks.ts')
  const { readPackageJson } = await import('../audit/project.ts')
  const framework = (await detectFramework(cwd, await readPackageJson(cwd)))?.framework.name
  const pages = result.audits.length === 1 ? '1 page' : `${result.audits.length} pages`
  lines.push(`  Site       ${where}${framework === undefined ? '' : ` (${framework})`}, ${pages}`)

  const facts =
    result.directory === undefined
      ? {}
      : await (await import('../audit/site.ts')).readSiteFacts(result.directory)
  const country = facts.lang === undefined ? undefined : countryForLocale(facts.lang)
  if (facts.lang !== undefined) {
    const law =
      country === undefined
        ? ''
        : pc.dim(` → a statement under ${COUNTRY_INFO[country].name}'s law`)
    lines.push(`  Language   ${facts.lang}${law}`)
  } else {
    lines.push(`  Language   ${pc.yellow('none declared')} ${pc.dim('(<html lang> is missing)')}`)
  }
  if (facts.url !== undefined) lines.push(`  Address    ${facts.url}`)

  const report = path.resolve(cwd, FIRST_RUN_REPORT)
  if (await exists(report)) {
    lines.push(`  Report     ${pathToFileURL(report).href}`)
  }

  lines.push('', pc.bold('Next'))
  const next = (command: string, why: string): void => {
    lines.push(`  ${pc.cyan(command.padEnd(24))}${why}`)
  }

  const { existingConfig } = await import('./init.ts')
  const config = await existingConfig(cwd)
  if (config === undefined) {
    next(
      'eaa-kit init',
      country === undefined
        ? 'write the config your accessibility statement is made from'
        : `write the config for your statement, with ${COUNTRY_INFO[country].name} filled in`,
    )
  } else {
    next('eaa-kit statement', `write your accessibility statement from ${config}`)
  }

  const failing = result.audits.some((audit) => audit.violations.length > 0)
  if (failing && !(await exists(path.join(cwd, DEFAULT_BASELINE_FILE)))) {
    next('eaa-kit baseline', "accept today's findings; later runs fail only on new ones")
  }
  if (result.directory !== undefined) {
    next('eaa-kit audit --watch', 'check again on every build while you fix things')
  }
  next('eaa-kit checklist', 'the 34 criteria no automated test can check')

  return `${lines.join('\n')}\n`
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}
