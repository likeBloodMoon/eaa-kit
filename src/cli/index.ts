#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'
import { DEFAULT_BASELINE_FILE } from '../audit/baseline.ts'
import { DEFAULT_FAIL_ON, IMPACT_LEVELS, type ImpactLevel, isImpactLevel } from '../audit/impact.ts'
import {
  COUNTRIES,
  type Country,
  STATEMENT_LOCALES,
  type StatementLocale,
} from '../config/define.ts'
import { TOOL_VERSION } from '../version.ts'
import { isOutputFormat, OUTPUT_FORMATS, type OutputFormat, runAuditCommand } from './audit.ts'
import { runBaselineCommand } from './baseline.ts'
import {
  isStatementFormat,
  runStatementCommand,
  STATEMENT_FORMATS,
  type StatementFormat,
} from './statement.ts'

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
  .option('--allow-remote', 'allow --url to crawl a host that is not localhost')
  .option('--ignore-robots', 'crawl paths robots.txt disallows')
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
  .action(async (dir: string | undefined, options: Record<string, unknown>) => {
    const { exitCode } = await runAuditCommand(dir, {
      ...(options['build'] === false ? { noBuild: true } : {}),
      ...(Array.isArray(options['include']) ? { include: options['include'] as string[] } : {}),
      ...(Array.isArray(options['exclude']) ? { exclude: options['exclude'] as string[] } : {}),
      ...(typeof options['baseUrl'] === 'string' ? { baseUrl: options['baseUrl'] } : {}),
      failOn: options['failOn'] as ImpactLevel,
      format: options['format'] as OutputFormat,
      ...(typeof options['output'] === 'string' ? { output: options['output'] } : {}),
      ...(options['browser'] === true ? { browser: true } : {}),
      ...(typeof options['concurrency'] === 'number'
        ? { concurrency: options['concurrency'] }
        : {}),
      ...(typeof options['baseline'] === 'string' ? { baseline: options['baseline'] } : {}),
      ...(typeof options['url'] === 'string' ? { url: options['url'] } : {}),
      ...(options['allowRemote'] === true ? { allowRemote: true } : {}),
      ...(options['ignoreRobots'] === true ? { ignoreRobots: true } : {}),
      ...(typeof options['maxPages'] === 'number' ? { maxPages: options['maxPages'] } : {}),
      ...(typeof options['maxDepth'] === 'number' ? { maxDepth: options['maxDepth'] } : {}),
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
  .option('--max-pages <n>', 'stop the crawl after this many pages', parsePositive)
  .option('--max-depth <n>', 'how far from the entry URL to follow links', parseDepth)
  .option('--output <path>', `where to write it (default: ${DEFAULT_BASELINE_FILE})`)
  .option('--note <text>', 'recorded on every entry, for whoever reads the file')
  .option('--expires-on <date>', 'ISO date after which the entries stop suppressing', parseDate)
  .option('--browser', 'audit in real Chromium instead of jsdom')
  .option('--concurrency <n>', 'worker threads to audit with, or 1 for none', parseConcurrency)
  .action(async (dir: string, options: Record<string, unknown>) => {
    const { exitCode } = await runBaselineCommand(dir, {
      ...(Array.isArray(options['include']) ? { include: options['include'] as string[] } : {}),
      ...(Array.isArray(options['exclude']) ? { exclude: options['exclude'] as string[] } : {}),
      ...(typeof options['baseUrl'] === 'string' ? { baseUrl: options['baseUrl'] } : {}),
      ...(typeof options['output'] === 'string' ? { output: options['output'] } : {}),
      ...(typeof options['note'] === 'string' ? { note: options['note'] } : {}),
      ...(typeof options['expiresOn'] === 'string' ? { expiresOn: options['expiresOn'] } : {}),
      ...(options['browser'] === true ? { browser: true } : {}),
      ...(typeof options['concurrency'] === 'number'
        ? { concurrency: options['concurrency'] }
        : {}),
      ...(typeof options['url'] === 'string' ? { url: options['url'] } : {}),
      ...(options['allowRemote'] === true ? { allowRemote: true } : {}),
      ...(options['ignoreRobots'] === true ? { ignoreRobots: true } : {}),
      ...(typeof options['maxPages'] === 'number' ? { maxPages: options['maxPages'] } : {}),
      ...(typeof options['maxDepth'] === 'number' ? { maxDepth: options['maxDepth'] } : {}),
    })
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
  .action(async (options: Record<string, unknown>) => {
    const { exitCode } = await runStatementCommand({
      ...(typeof options['config'] === 'string' ? { config: options['config'] } : {}),
      ...(options['lang'] ? { locale: options['lang'] as StatementLocale } : {}),
      ...(options['country'] ? { country: options['country'] as Country } : {}),
      ...(typeof options['audit'] === 'string' ? { audit: options['audit'] } : {}),
      ...(options['format'] ? { format: options['format'] as StatementFormat } : {}),
      ...(typeof options['output'] === 'string' ? { output: options['output'] } : {}),
    })
    process.exitCode = exitCode
  })

function parseLocale(value: string): StatementLocale {
  if (!(STATEMENT_LOCALES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`expected one of ${STATEMENT_LOCALES.join(', ')}`)
  }
  return value as StatementLocale
}

function parseCountry(value: string): Country {
  const upper = value.toUpperCase()
  if (!(COUNTRIES as readonly string[]).includes(upper)) {
    throw new InvalidArgumentError(`expected one of ${COUNTRIES.join(', ')}`)
  }
  return upper as Country
}

function parseStatementFormat(value: string): StatementFormat {
  if (!isStatementFormat(value)) {
    throw new InvalidArgumentError(`expected one of ${STATEMENT_FORMATS.join(', ')}`)
  }
  return value
}

function parseDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new InvalidArgumentError('expected an ISO date, e.g. 2026-12-31')
  }
  return value
}

function parsePositive(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('expected a whole number of 1 or more')
  }
  return parsed
}

/** Depth 0 is meaningful here: audit only the entry page. */
function parseDepth(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError('expected a whole number of 0 or more')
  }
  return parsed
}

function parseConcurrency(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('expected a whole number of 1 or more')
  }
  return parsed
}

function parseImpact(value: string): ImpactLevel {
  if (!isImpactLevel(value)) {
    throw new InvalidArgumentError(`expected one of ${IMPACT_LEVELS.join(', ')}`)
  }
  return value
}

function parseFormat(value: string): OutputFormat {
  if (!isOutputFormat(value)) {
    throw new InvalidArgumentError(`expected one of ${OUTPUT_FORMATS.join(', ')}`)
  }
  return value
}

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
