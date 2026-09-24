import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import pc from 'picocolors'
import { DEFAULT_BASELINE_FILE } from '../audit/baseline.ts'
import { DEFAULT_FAIL_ON } from '../audit/impact.ts'
import { COUNTRY_INFO, countryForLocale, findCountry } from '../config/countries.ts'
import { COUNTRIES, type Country } from '../config/define.ts'
import { CONFIG_FILENAMES } from '../config/load.ts'
import { exists } from '../fs.ts'
import { fail, nextStep, note, warn } from './command.ts'
import { findGitRoot, WORKFLOW_FILE, workflowFor } from './setup.ts'

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
  /** `--no-ci`: never offer the GitHub Actions workflow. */
  ci?: false
  /** `--no-baseline`: never offer to record a baseline. */
  baseline?: false
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

  // The built site, when there is one, states more than package.json does:
  // its language on <html lang> and its address on the canonical link. Both
  // win over package.json, whose homepage is as often the repository as the
  // site. Nothing is built or started to find them; a project with no build
  // yet simply gets the package.json answers.
  const site = await builtSite(cwd)
  if (site !== undefined) {
    const { readSiteFacts } = await import('../audit/site.ts')
    const facts = await readSiteFacts(site)
    if (facts.url !== undefined) detected.url = facts.url
    if (facts.title !== undefined && detected.name === undefined) detected.name = facts.title
    if (facts.lang !== undefined) {
      detected.locale = facts.lang
      const country = countryForLocale(facts.lang)
      if (country !== undefined) detected.country = country
    }
  }
  return detected
}

/** The built site's directory, from the same search `audit` makes, without building. */
async function builtSite(cwd: string): Promise<string | undefined> {
  const { autoDetectSource } = await import('../audit/project.ts')
  const found = await autoDetectSource(cwd, { noBuild: true })
  await found?.cleanup?.()
  return found?.directory
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
    warn(`${already} already exists, and init never overwrites one without being told to.`)
    nextStep({ command: 'eaa-kit init --force', why: `start ${already} again from scratch` })
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
  const country = await askCountry(ask, rl !== undefined, detected.country)
  const locale = await ask(
    'Language of the site',
    // The site's own tag, when the country chosen is the one it points at.
    // Somebody who picks another country is saying the site is not what it
    // looks like, and gets that country's language instead.
    detected.locale !== undefined && detected.country === country
      ? detected.locale
      : COUNTRY_INFO[country].siteLocale,
  )
  const legalName = await ask('Legal entity answerable for the site', name)
  const email = await ask('Feedback email', '')
  const feedbackUrl = await ask('Feedback or contact form URL (optional)', '')

  // The other two things a project needs before the tool is doing its job.
  // Each is only offered where it can work: a baseline needs a build that is
  // already there, since init never runs one, and a workflow needs a git
  // repository and no workflow of the same name, which is never overwritten.
  const site = options.baseline === false ? undefined : await builtSite(cwd)
  const recordBaseline =
    site !== undefined &&
    isYes(
      await ask(
        'Record a baseline of the barriers the site has today, so CI fails only on new ones? (y/n)',
        'y',
      ),
    )
  const root = options.ci === false ? undefined : await findGitRoot(cwd)
  const workflowPath = root === undefined ? undefined : path.join(root, WORKFLOW_FILE)
  const writeWorkflow =
    workflowPath !== undefined &&
    !(await exists(workflowPath)) &&
    isYes(await ask('Add a GitHub Actions workflow that audits every push? (y/n)', 'y'))

  // Before any writing: an open stdin handle keeps the process alive after the
  // file is written, and the reader is left looking at a prompt that has gone.
  terminal?.close()

  // Before the config, so the config can point at it: a baseline the project
  // records is one `eaa-kit audit` should read without being told.
  let baseline: string | undefined
  if (recordBaseline && site !== undefined) {
    const { runBaselineCommand } = await import('./baseline.ts')
    const recorded = await runBaselineCommand(path.relative(cwd, site) || '.', { cwd })
    if (recorded.exitCode === 0) baseline = DEFAULT_BASELINE_FILE
  } else if (await exists(path.join(cwd, DEFAULT_BASELINE_FILE))) {
    // One recorded earlier is still one the workflow and the audit should read.
    baseline = DEFAULT_BASELINE_FILE
  }

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
    audit: { failOn: DEFAULT_FAIL_ON, ...(baseline === undefined ? {} : { baseline }) },
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
      'which is the honest default before an audit has run.',
  )

  if (writeWorkflow && root !== undefined && workflowPath !== undefined) {
    const workflow = await workflowFor({
      cwd,
      root,
      ...(site === undefined ? {} : { site }),
      ...(baseline === undefined ? {} : { baseline }),
      failOn: DEFAULT_FAIL_ON,
    })
    try {
      await mkdir(path.dirname(workflowPath), { recursive: true })
      await writeFile(workflowPath, workflow, 'utf8')
      process.stderr.write(`Wrote ${path.relative(cwd, workflowPath)}\n`)
    } catch (cause) {
      // The config is written and is the part that matters; a workflow that
      // could not be is reported, not turned into a failed init.
      warn(
        `Could not write ${WORKFLOW_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
  }

  note(
    `\nNext:  eaa-kit statement${writeWorkflow ? '  ·  commit and push to run the workflow' : '  ·  eaa-kit audit'}`,
  )
  return { file: target, exitCode: 0 }
}

function isYes(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim())
}

/** How often an answer that is not a country is asked again before giving up on it. */
const COUNTRY_ATTEMPTS = 3

/**
 * The country whose law the statement is written under.
 *
 * An answer that is not a country is asked again, with the list. It used to
 * become Austria without a word, which is how somebody who typed `pl` got an
 * Austrian legal document. Once the attempts run out the default is used,
 * because a typo should not throw away every other answer, but it is said out
 * loud, so the file is not left looking like the answer somebody gave.
 */
async function askCountry(
  ask: (question: string, fallback: string) => Promise<string>,
  interactive: boolean,
  suggested: Country | undefined,
): Promise<Country> {
  const fallback: Country = suggested ?? 'AT'
  const choices = COUNTRIES.map((code) => `${code} ${COUNTRY_INFO[code].name}`).join(', ')
  if (interactive) process.stderr.write(pc.dim(`Countries: ${choices}\n`))

  let answer = ''
  for (let attempt = 0; attempt < COUNTRY_ATTEMPTS; attempt += 1) {
    answer = await ask('Country whose law applies', fallback)
    const country = findCountry(answer)
    if (country !== undefined) return country
    warn(
      `${answer} is not one of the countries a statement can be written for: ${COUNTRIES.join(', ')}`,
    )
  }

  warn(
    `enforcement.country is set to ${fallback} because ${answer} was not recognised. ` +
      'Change it before generating a statement.',
  )
  return fallback
}
