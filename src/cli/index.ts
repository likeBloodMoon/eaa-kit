#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'
import { DEFAULT_BASELINE_FILE } from '../audit/baseline.ts'
import { DEFAULT_FAIL_ON, IMPACT_LEVELS, type ImpactLevel } from '../audit/impact.ts'
import {
  COUNTRIES,
  type Country,
  STATEMENT_LOCALES,
  type StatementLocale,
} from '../config/define.ts'
import { TOOL_VERSION } from '../version.ts'
import { type AuditCommandOptions, OUTPUT_FORMATS, runAuditCommand } from './audit.ts'
import { type BaselineCommandOptions, runBaselineCommand } from './baseline.ts'
import {
  runStatementCommand,
  STATEMENT_FORMATS,
  type StatementCommandOptions,
} from './statement.ts'

/**
 * Commander has already validated and converted every flag through the parsers
 * below, and it leaves an option nobody passed out of the object entirely — so
 * the parsed flags are the command options, and each action hands them over
 * rather than rebuilding them key by key. The two exceptions are named where
 * they occur: `--no-build`, which commander reports as `build`, and `--lang`,
 * which the statement command calls `locale`.
 */
type AuditFlags = Omit<AuditCommandOptions, 'noBuild' | 'cwd' | 'timeoutMs'> & { build: boolean }
type BaselineFlags = Omit<BaselineCommandOptions, 'cwd' | 'timeoutMs'>
type StatementFlags = Omit<StatementCommandOptions, 'locale' | 'cwd'> & { lang?: StatementLocale }

/**
 * A parser for a fixed set of words, listing them when the answer is not one.
 *
 * `normalise` is for `--country de`, where the accepted spelling differs from
 * what somebody types.
 */
function oneOf<const T extends readonly string[]>(
  values: T,
  normalise: (value: string) => string = (value) => value,
): (value: string) => T[number] {
  return (value) => {
    const candidate = normalise(value)
    if (!(values as readonly string[]).includes(candidate)) {
      throw new InvalidArgumentError(`expected one of ${values.join(', ')}`)
    }
    return candidate as T[number]
  }
}

/** A whole number no smaller than `min`. Depth allows 0: audit the entry page alone. */
function wholeNumber(min: number): (value: string) => number {
  return (value) => {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < min) {
      throw new InvalidArgumentError(`expected a whole number of ${min} or more`)
    }
    return parsed
  }
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new InvalidArgumentError('expected an ISO date, e.g. 2026-12-31')
  }
  return value
}

const parseLocale = oneOf(STATEMENT_LOCALES)
const parseCountry = oneOf(COUNTRIES, (value) => value.toUpperCase())
const parseStatementFormat = oneOf(STATEMENT_FORMATS)
const parseImpact = oneOf(IMPACT_LEVELS)
const parseFormat = oneOf(OUTPUT_FORMATS)
const parsePositive = wholeNumber(1)
const parseDepth = wholeNumber(0)
const parseConcurrency = wholeNumber(1)

const program = new Command()

// Commander exits 1 on usage errors; this CLI reserves 1 for "violations found"
// so that a typo in a flag can never be mistaken for a failing audit.
program.exitOverride()

program
  .name('eaa-kit')
  .description(
    'WCAG 2.2 AA auditor and EU accessibility statement generator for static sites.\n' +
      'Not legal advice.',
  )
  .version(TOOL_VERSION, '-v, --version')

program
  .command('audit')
  .description('Audit built HTML against WCAG 2.2 AA')
  .argument('[dir]', 'directory holding the built site (default: found automatically)')
  .option('--include <globs...>', 'glob patterns to audit, relative to dir')
  .option('--exclude <globs...>', 'glob patterns to skip')
  .option('--base-url <url>', 'audit pages under their real site URL')
  .option('--url <url>', 'audit a running site instead of a build directory')
  .option('--no-build', 'never run the project build or start its server')
  .option('--per-page', 'also list every page and its result')
  .option('--manual', 'what to check by hand for the rules this engine cannot evaluate')
  .option('--allow-remote', 'allow --url to crawl a host that is not localhost')
  .option('--ignore-robots', 'crawl paths robots.txt disallows')
  .option('--sitemap <path>', 'where the site lists its pages, if not /sitemap.xml')
  .option('--max-pages <n>', 'stop the crawl after this many pages', parsePositive)
  .option('--max-depth <n>', 'how far from the entry URL to follow links', parseDepth)
  .option(
    '--fail-on <impact>',
    `exit 1 on violations at or above this impact (${IMPACT_LEVELS.join('|')})`,
    parseImpact,
    DEFAULT_FAIL_ON,
  )
  .option(
    '--format <format>',
    `output format (${OUTPUT_FORMATS.join('|')})`,
    parseFormat,
    'console',
  )
  .option('--output <path>', 'write the report to a file instead of stdout')
  .option('--browser', 'audit in real Chromium, covering the rules jsdom cannot evaluate')
  .option(
    '--concurrency <n>',
    'worker threads to audit with, or 1 for none (default: from the page and core count)',
    parseConcurrency,
  )
  .option('--baseline <path>', 'accept the violations recorded in this file; fail only on new ones')
  .action(async (dir: string | undefined, flags: AuditFlags) => {
    const { build, ...options } = flags
    const { exitCode } = await runAuditCommand(dir, {
      ...options,
      ...(build === false ? { noBuild: true } : {}),
    })
    process.exitCode = exitCode
  })

program
  .command('baseline')
  .description('Record the violations a build already has, so later runs fail only on new ones')
  .argument('[dir]', 'directory holding the built site', './dist')
  .option('--include <globs...>', 'glob patterns to audit, relative to dir')
  .option('--exclude <globs...>', 'glob patterns to skip')
  .option('--base-url <url>', 'audit pages under their real site URL')
  .option('--url <url>', 'record a baseline from a running site instead of a directory')
  .option('--allow-remote', 'allow --url to crawl a host that is not localhost')
  .option('--ignore-robots', 'crawl paths robots.txt disallows')
  .option('--sitemap <path>', 'where the site lists its pages, if not /sitemap.xml')
  .option('--max-pages <n>', 'stop the crawl after this many pages', parsePositive)
  .option('--max-depth <n>', 'how far from the entry URL to follow links', parseDepth)
  .option('--output <path>', `where to write it (default: ${DEFAULT_BASELINE_FILE})`)
  .option('--note <text>', 'recorded on every entry, for whoever reads the file')
  .option('--expires-on <date>', 'ISO date after which the entries stop suppressing', parseDate)
  .option('--browser', 'audit in real Chromium instead of jsdom')
  .option('--concurrency <n>', 'worker threads to audit with, or 1 for none', parseConcurrency)
  .action(async (dir: string, flags: BaselineFlags) => {
    const { exitCode } = await runBaselineCommand(dir, flags)
    process.exitCode = exitCode
  })

program
  .command('init')
  .description('Write an eaa.config.json to generate statements from')
  .option('--output <path>', 'write here instead of eaa.config.json')
  .option('--force', 'overwrite a config that is already there')
  .option('-y, --yes', 'take every default without asking')
  .action(async (flags: { output?: string; force?: true; yes?: true }) => {
    const { runInitCommand } = await import('./init.ts')
    const { exitCode } = await runInitCommand(flags)
    process.exitCode = exitCode
  })

program
  .command('statement')
  .description('Generate an EU accessibility statement from eaa.config')
  .option('--config <path>', 'path to the config file, otherwise it is searched for')
  .option('--lang <locale>', `statement language (${STATEMENT_LOCALES.join('|')})`, parseLocale)
  .option(
    '--country <code>',
    `override the country template (${COUNTRIES.join('|')})`,
    parseCountry,
  )
  .option('--audit <path>', 'list the barriers from an eaa-kit audit --format json report')
  .option(
    '--format <format>',
    `output format (${STATEMENT_FORMATS.join('|')}), otherwise from the --output extension`,
    parseStatementFormat,
  )
  .option('--output <path>', 'write the statement to a file instead of stdout')
  .action(async (flags: StatementFlags) => {
    const { lang, ...options } = flags
    const { exitCode } = await runStatementCommand({
      ...options,
      ...(lang === undefined ? {} : { locale: lang }),
    })
    process.exitCode = exitCode
  })

try {
  await program.parseAsync(process.argv)
} catch (cause) {
  // --help and --version land here too, with exitCode 0; everything else is a
  // usage error, which this CLI reports as 2.
  const error = cause as { exitCode?: number; message?: string }
  if (typeof error.exitCode === 'number') {
    process.exitCode = error.exitCode === 0 ? 0 : 2
  } else {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`)
    process.exitCode = 2
  }
}
