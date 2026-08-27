#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander'
import { DEFAULT_FAIL_ON, IMPACT_LEVELS, type ImpactLevel, isImpactLevel } from '../audit/impact.ts'
import {
  COUNTRIES,
  type Country,
  STATEMENT_LOCALES,
  type StatementLocale,
} from '../config/define.ts'
import { TOOL_VERSION } from '../version.ts'
import { isOutputFormat, OUTPUT_FORMATS, type OutputFormat, runAuditCommand } from './audit.ts'
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
  .argument('[dir]', 'directory holding the built site', './dist')
  .option('--include <globs...>', 'glob patterns to audit, relative to dir')
  .option('--exclude <globs...>', 'glob patterns to skip')
  .option('--base-url <url>', 'audit pages under their real site URL')
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
  .action(async (dir: string, options: Record<string, unknown>) => {
    const { exitCode } = await runAuditCommand(dir, {
      ...(Array.isArray(options['include']) ? { include: options['include'] as string[] } : {}),
      ...(Array.isArray(options['exclude']) ? { exclude: options['exclude'] as string[] } : {}),
      ...(typeof options['baseUrl'] === 'string' ? { baseUrl: options['baseUrl'] } : {}),
      failOn: options['failOn'] as ImpactLevel,
      format: options['format'] as OutputFormat,
      ...(typeof options['output'] === 'string' ? { output: options['output'] } : {}),
      ...(options['browser'] === true ? { browser: true } : {}),
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
