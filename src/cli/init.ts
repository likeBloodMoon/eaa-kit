import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import pc from 'picocolors'
import { DEFAULT_FAIL_ON } from '../audit/impact.ts'
import { COUNTRIES, type Country } from '../config/define.ts'
import { CONFIG_FILENAMES } from '../config/load.ts'
import { exists } from '../fs.ts'
import { fail, note, warn } from './command.ts'

/**
 * `eaa-kit init`.
 *
 * `audit` needs nothing but the project. `statement` needed a config file whose
 * schema you had to go and read first, which made "install it and run it" true
 * of one half of the tool and false of the other.
 *
 * This asks only for what it genuinely cannot know — who is answerable for the
 * site, where to send feedback, which country's law applies — and works out the
 * rest from the project. Everything it writes is a claim the provider is making,
 * so nothing here is filled in on their behalf: it asks, and it says what each
 * answer will appear as.
 */

export interface InitCommandOptions {
  cwd?: string
  /** Write here instead of eaa.config.json. */
  output?: string
  /** Overwrite a config that is already there. */
  force?: boolean
  /**
   * Take every default without asking. For CI and for anyone who would rather
   * edit a file than answer questions — the result still needs editing, and
   * says so.
   */
  yes?: boolean
  /** Injectable so the prompts can be tested without a terminal. */
  ask?: (question: string, fallback: string) => Promise<string>
}

export interface InitCommandResult {
  /** Where it was written, or undefined if nothing was. */
  file?: string
  /** 0 written, 1 refused because a config exists, 2 could not be written. */
  exitCode: number
}

/** What could be worked out without asking. */
interface Detected {
  name?: string
  url?: string
  locale?: string
  country?: Country
}

const COUNTRY_LOCALES: Record<Country, string> = {
  AT: 'de-AT',
  DE: 'de-DE',
  CH: 'de-CH',
}

/**
 * Everything the project already says about itself.
 *
 * A guess that is wrong is worse than an empty field somebody has to fill, so
 * this only reads what a project states outright.
 */
export async function detectDefaults(cwd: string): Promise<Detected> {
  const detected: Detected = {}
  try {
    const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')) as {
      name?: string
      homepage?: string
    }
    if (typeof pkg.name === 'string' && pkg.name !== '') {
      // Package names are lowercase and hyphenated; a legal name is neither, so
      // this is a starting point rather than an answer.
      detected.name = pkg.name.replace(/^@[^/]+\//, '')
    }
    if (typeof pkg.homepage === 'string' && /^https?:\/\//.test(pkg.homepage)) {
      detected.url = pkg.homepage
    }
  } catch {
    // no package.json, or not JSON: nothing to read
  }
  return detected
}

/** Whether a config is already there, so init never overwrites one silently. */
export async function existingConfig(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILENAMES) {
    if (await exists(path.join(cwd, name))) return name
  }
  return undefined
}

interface Prompt {
  ask: (question: string, fallback: string) => Promise<string>
  /** Must be called, or the open stdin handle holds the process open. */
  close: () => void
}

/** Reads answers, showing what each will be if the reader just hits enter. */
function terminalPrompt(): Prompt {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  return {
    ask: async (question: string, fallback: string): Promise<string> => {
      const shown = fallback === '' ? '' : pc.dim(` (${fallback})`)
      const answer = (await rl.question(`${question}${shown}: `)).trim()
      return answer === '' ? fallback : answer
    },
    close: () => rl.close(),
  }
}

export async function runInitCommand(options: InitCommandOptions = {}): Promise<InitCommandResult> {
  const cwd = options.cwd ?? process.cwd()
  const target = path.resolve(cwd, options.output ?? 'eaa.config.json')

  const already = await existingConfig(cwd)
  if (already !== undefined && !options.force) {
    warn(`${already} already exists. Pass --force to overwrite it.`)
    return { exitCode: 1 }
  }

  const detected = await detectDefaults(cwd)
  const terminal =
    options.ask === undefined && !options.yes && process.stdin.isTTY === true
      ? terminalPrompt()
      : undefined
  const rl = options.ask ?? terminal?.ask
  const ask = async (question: string, fallback: string): Promise<string> =>
    rl === undefined ? fallback : rl(question, fallback)

  if (rl !== undefined) {
    process.stderr.write(
      `${pc.bold('eaa-kit init')}\n${pc.dim('Everything here is a claim you are making. Press enter to take a default.\n\n')}`,
    )
  }

  const name = await ask('Site name', detected.name ?? '')
  const url = await ask('Site URL', detected.url ?? 'https://example.com')
  const country = normaliseCountry(
    await ask(`Country whose law applies (${COUNTRIES.join('/')})`, 'AT'),
  )
  const locale = await ask('Language of the site', COUNTRY_LOCALES[country])
  const legalName = await ask('Legal entity answerable for the site', name)
  const email = await ask('Feedback email', '')
  const feedbackUrl = await ask('Feedback or contact form URL (optional)', '')
  // Before any writing: an open stdin handle keeps the process alive after the
  // file is written, and the reader is left looking at a prompt that has gone.
  terminal?.close()

  const config = {
    site: { name, url, locale },
    provider: {
      legalName,
      email,
      ...(feedbackUrl === '' ? {} : { feedbackUrl }),
    },
    compliance: {
      // Not 'compliant'. A statement claiming full conformance for a site
      // nobody has assessed is worse than no statement, and this file is
      // written before any audit has run.
      status: 'partially-compliant',
      assessedOn: new Date().toISOString().slice(0, 10),
      assessmentMethod: 'self-assessment',
      knownIssues: [],
    },
    enforcement: { country },
    // Defaults for `eaa-kit audit`, so a project says once what every
    // invocation would otherwise repeat. This one restates the built-in
    // threshold rather than changing anything: it is here to be found and
    // edited, since a block nobody knows about is a feature nobody has.
    audit: { failOn: DEFAULT_FAIL_ON },
  }

  try {
    await writeFile(target, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    fail(`Could not write ${path.basename(target)}: ${reason}`)
    return { exitCode: 2 }
  }

  process.stderr.write(`Wrote ${path.relative(cwd, target) || path.basename(target)}\n`)
  const missing = [
    name === '' ? 'site.name' : undefined,
    email === '' ? 'provider.email' : undefined,
  ].filter((field) => field !== undefined)
  if (missing.length > 0) {
    const [verb, pronoun] = missing.length === 1 ? ['is', 'it'] : ['are', 'them']
    warn(
      `${missing.join(' and ')} ${verb} empty and required. Fill ${pronoun} in before generating a statement.`,
    )
  }
  note(
    'Read it before publishing anything from it: status is partially-compliant,\n' +
      'which is the honest default before an audit has run.\n' +
      '\n' +
      'Next:  eaa-kit audit  ·  eaa-kit statement',
  )

  return { file: target, exitCode: 0 }
}

/** Falls back rather than failing: a typo should not throw away the answers. */
function normaliseCountry(value: string): Country {
  const upper = value.trim().toUpperCase()
  return (COUNTRIES as readonly string[]).includes(upper) ? (upper as Country) : 'AT'
}
