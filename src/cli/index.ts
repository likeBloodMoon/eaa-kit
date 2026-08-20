#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command, InvalidArgumentError } from 'commander'
import { DEFAULT_FAIL_ON, IMPACT_LEVELS, type ImpactLevel, isImpactLevel } from '../audit/impact.ts'
import { runAuditCommand } from './audit.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

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
  .version(version, '-v, --version')

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
  .action(async (dir: string, options: Record<string, unknown>) => {
    const { exitCode } = await runAuditCommand(dir, {
      ...(Array.isArray(options['include']) ? { include: options['include'] as string[] } : {}),
      ...(Array.isArray(options['exclude']) ? { exclude: options['exclude'] as string[] } : {}),
      ...(typeof options['baseUrl'] === 'string' ? { baseUrl: options['baseUrl'] } : {}),
      failOn: options['failOn'] as ImpactLevel,
    })
    process.exitCode = exitCode
  })

function parseImpact(value: string): ImpactLevel {
  if (!isImpactLevel(value)) {
    throw new InvalidArgumentError(`expected one of ${IMPACT_LEVELS.join(', ')}`)
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
