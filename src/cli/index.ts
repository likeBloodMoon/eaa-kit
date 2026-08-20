#!/usr/bin/env node
import { createRequire } from 'node:module'
import { Command } from 'commander'
import { runAuditCommand } from './audit.ts'

const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }

const program = new Command()

program
  .name('eaa-kit')
  .description(
    'WCAG 2.2 AA auditor and EU accessibility statement generator for static sites.\n' +
      'Not legal advice.',
  )
  .version(version, '-v, --version')

program
  .command('audit', { isDefault: false })
  .description('Audit built HTML against WCAG 2.2 AA')
  .argument('[dir]', 'directory holding the built site', './dist')
  .option('--include <globs...>', 'glob patterns to audit, relative to dir')
  .option('--exclude <globs...>', 'glob patterns to skip')
  .option('--base-url <url>', 'audit pages under their real site URL')
  .action(async (dir: string, options: Record<string, string[] | string | undefined>) => {
    const { exitCode } = await runAuditCommand(dir, {
      ...(Array.isArray(options['include']) ? { include: options['include'] } : {}),
      ...(Array.isArray(options['exclude']) ? { exclude: options['exclude'] } : {}),
      ...(typeof options['baseUrl'] === 'string' ? { baseUrl: options['baseUrl'] } : {}),
    })
    process.exitCode = exitCode
  })

program.parseAsync(process.argv).catch((cause: unknown) => {
  process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`)
  process.exitCode = 2
})
