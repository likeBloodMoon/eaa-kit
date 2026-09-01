import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isFile } from '../fs.ts'
import {
  type AuditConfig,
  ConfigError,
  type EaaConfig,
  parseAuditConfig,
  parseConfig,
} from './define.ts'

/** Checked in this order, first match wins. */
export const CONFIG_FILENAMES = [
  'eaa.config.ts',
  'eaa.config.mts',
  'eaa.config.js',
  'eaa.config.mjs',
  'eaa.config.json',
] as const

export interface LoadedConfig {
  config: EaaConfig
  /** Absolute path of the file it came from. */
  path: string
}

export interface LoadConfigOptions {
  /** Where to start looking. Defaults to the working directory. */
  cwd?: string
  /** Explicit path, skipping the search. */
  path?: string
}

/**
 * Find and load `eaa.config.{ts,mts,js,mjs,json}`.
 *
 * TypeScript configs are imported directly: Node strips types natively from
 * 22.18 onwards, which is below this package's floor, so no bundler or loader
 * dependency is needed. The failure mode that remains is a project with no
 * package.json at all, where Node cannot tell ESM from CommonJS; the error says
 * so rather than surfacing "Unexpected token 'export'".
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const file = options.path ? path.resolve(cwd, options.path) : await findConfigFile(cwd)

  if (!file) {
    throw new ConfigError(
      `No config file found in ${cwd} or its parent directories`,
      CONFIG_FILENAMES.map((name) => `looked for ${name}`),
    )
  }

  if (!(await isFile(file))) {
    throw new ConfigError(`Config file not found: ${file}`)
  }

  return { config: parseConfig(await readConfigFile(file), path.basename(file)), path: file }
}

/** What an audit found in a config file, when there was one to find. */
export interface LoadedAuditConfig {
  /** The `audit` block, or undefined where the file has none. */
  audit: AuditConfig | undefined
  /** Absolute path of the file it came from. */
  path: string
}

/**
 * Find the config file and read its `audit` block, for the commands that take
 * defaults from it.
 *
 * Returns undefined when there is no config file at all. That is not an error
 * here as it is for `statement`: `eaa-kit audit` has always run against a
 * project that has never heard of a config file, and it must keep doing so. An
 * explicit path that is not there is still an error, because somebody named it.
 */
export async function loadAuditConfig(
  options: LoadConfigOptions = {},
): Promise<LoadedAuditConfig | undefined> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const file = options.path ? path.resolve(cwd, options.path) : await findConfigFile(cwd)

  if (!file) return undefined
  if (!(await isFile(file))) {
    throw new ConfigError(`Config file not found: ${file}`)
  }

  return { audit: parseAuditConfig(await readConfigFile(file), path.basename(file)), path: file }
}

function readConfigFile(file: string): Promise<unknown> {
  return file.endsWith('.json') ? importJson(file) : importModule(file)
}

/** Walks up from `cwd`, so the CLI works from a subdirectory of the project. */
export async function findConfigFile(cwd: string): Promise<string | undefined> {
  let directory = path.resolve(cwd)

  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(directory, name)
      if (await isFile(candidate)) return candidate
    }

    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

async function importJson(file: string): Promise<unknown> {
  const raw = await readFile(file, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new ConfigError(`${path.basename(file)} is not valid JSON`, [
      cause instanceof Error ? cause.message : String(cause),
    ])
  }
}

async function importModule(file: string): Promise<unknown> {
  let module: { default?: unknown }
  try {
    // Cache-busted so a second load in the same process sees an edited file,
    // which matters for tests and for watch mode later.
    module = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: unknown }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    const hint = message.includes('Unexpected token')
      ? 'If the project has no package.json, Node cannot tell ESM from CommonJS. Add one with "type": "module", or use eaa.config.json.'
      : message
    throw new ConfigError(`Could not load ${path.basename(file)}`, [hint])
  }

  if (module.default === undefined) {
    throw new ConfigError(`${path.basename(file)} has no default export`, [
      'Expected: export default defineConfig({ … })',
    ])
  }
  return module.default
}
