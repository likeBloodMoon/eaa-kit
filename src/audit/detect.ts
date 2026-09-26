import path from 'node:path'
import { toPosix } from '../fs.ts'
import { detectFramework } from './frameworks.ts'
import {
  findBuildOutput,
  findPackageManager,
  type PackageManager,
  readPackageJson,
} from './project.ts'

/**
 * What `eaa-kit` would do in this project, and why, without doing any of it.
 *
 * Zero-config only works when its decisions can be checked. Before this, the
 * only way to find out what the tool made of a project was to run an audit and
 * read the progress lines, which builds the project and starts its server on
 * the way. This reads the same facts and stops there: nothing is built,
 * started or written.
 *
 * It is also what the stack fixtures are tested against, so every framework
 * the registry claims to know has a recorded answer that cannot drift.
 */

export type DetectionPlan =
  /** A build with HTML in it is already there, and is audited as files. */
  | 'audit-build'
  /** The project's build is run first, then its output is audited. */
  | 'build'
  /** The project's build is run, then its server is started and crawled. */
  | 'build-and-serve'
  /** The project's server is started and crawled, with nothing to build. */
  | 'serve'
  /** A CMS or server framework: never started uninvited, audited with --url. */
  | 'url'
  /** A monorepo with several sites: one has to be chosen. */
  | 'choose-site'
  /** Nothing this can audit without being told where. */
  | 'nothing'

export interface ProjectDetection {
  framework?: { id: string; name: string; evidence: string[] }
  /** Only for a project with a package.json: nothing else is installed with one. */
  packageManager?: { name: PackageManager; evidence: string }
  plan: DetectionPlan
  /** In words, one sentence: what an audit here would do. */
  summary: string
  /** Output directories tried, most likely first, relative to cwd. */
  outputs: string[]
  /** The build found or expected, relative to cwd. */
  directory?: string
  /** The command an audit would run to build, if any. */
  build?: string
  /** The command an audit would run to serve, if any. */
  serve?: string
  /** For a CMS: how to get the site running so --url has something to crawl. */
  serveCommand?: string
  /**
   * The page the build starts from is an empty single-page-app shell, so its
   * output will be one too: audit it with --browser.
   */
  appShell?: true
  /** A Next.js build's own page list, when one is there to read. */
  next?: { output?: string; basePath?: string; pages: number; dynamic: string[] }
  /** A monorepo: the file that made it one, and its sites. */
  workspace?: { evidence: string; sites: Array<{ dir: string; framework: string }> }
  /** When a monorepo has one site, what detection concluded inside it. */
  site?: ProjectDetection
}

export async function detectProject(cwd: string): Promise<ProjectDetection> {
  const pkg = await readPackageJson(cwd)
  const manager = await findPackageManager(cwd)
  const detected = await detectFramework(cwd, pkg)
  const { candidateOutputs } = await import('./frameworks.ts')
  const base: ProjectDetection = {
    ...(detected === undefined
      ? {}
      : {
          framework: {
            id: detected.framework.id,
            name: detected.framework.name,
            evidence: detected.evidence,
          },
        }),
    ...(pkg === undefined
      ? {}
      : { packageManager: { name: manager.manager, evidence: manager.evidence } }),
    plan: 'nothing',
    summary: '',
    outputs: await candidateOutputs(cwd, pkg),
  }
  const run = (script: string): string =>
    `${manager.manager} ${manager.manager === 'deno' ? 'task' : 'run'} ${script}`
  const relative = (dir: string): string => toPosix(path.relative(cwd, dir)) || '.'

  const existing = await findBuildOutput(cwd)
  if (existing !== undefined) {
    return {
      ...base,
      plan: 'audit-build',
      directory: relative(existing),
      summary: `audit the build already in ${relative(existing)}/`,
    }
  }

  if (detected === undefined) {
    const { findWorkspaceSites } = await import('./workspaces.ts')
    const workspace = await findWorkspaceSites(cwd)
    const sites = workspace?.sites ?? []
    if (workspace !== undefined && sites.length > 0) {
      const listed = {
        evidence: workspace.evidence,
        sites: sites.map((site) => ({ dir: site.dir, framework: site.framework.framework.name })),
      }
      const only = sites[0]
      if (sites.length === 1 && only !== undefined) {
        const inner = await detectProject(path.join(cwd, only.dir))
        return {
          ...base,
          plan: inner.plan,
          workspace: listed,
          site: inner,
          summary: `go into ${only.dir}/, this monorepo's one site, and ${inner.summary}`,
        }
      }
      return {
        ...base,
        plan: 'choose-site',
        workspace: listed,
        summary: `do nothing until a site is chosen: this monorepo has ${sites.length}`,
      }
    }
  }

  if (detected !== undefined && detected.framework.outputs.length === 0) {
    return {
      ...base,
      plan: 'url',
      ...(detected.framework.serveCommand === undefined
        ? {}
        : { serveCommand: detected.framework.serveCommand }),
      summary: `do nothing on its own: ${detected.framework.name} renders on a server, so start the site and audit it with --url`,
    }
  }

  if (pkg === undefined) {
    const { glob } = await import('tinyglobby')
    const html = await glob(['*.html', '*.htm'], { cwd, onlyFiles: true, dot: false })
    if (detected === undefined && html.length > 0) {
      return {
        ...base,
        plan: 'audit-build',
        directory: '.',
        summary: 'audit the hand-written HTML in this folder',
      }
    }
    const command = detected?.framework.buildCommand
    if (command !== undefined) {
      return {
        ...base,
        build: command,
        summary: `do nothing yet: build the site with ${command} first`,
      }
    }
    return { ...base, summary: 'do nothing: there is no build, no package.json and no HTML here' }
  }

  const scripts = pkg.scripts ?? {}
  const isNext = detected?.framework.id === 'next'
  const nextFacts = isNext ? await readNext(cwd) : undefined
  const servesAfterBuild = isNext && nextFacts?.output !== 'export'
  const serveScript = servesAfterBuild
    ? scripts['start'] !== undefined
      ? run('start')
      : 'next start'
    : ['start', 'preview', 'serve'].filter((name) => scripts[name] !== undefined).map(run)[0]
  const withNext = nextFacts === undefined ? {} : { next: nextFacts }

  if (scripts['build'] !== undefined) {
    const expected = base.outputs[0]
    if (servesAfterBuild) {
      return {
        ...base,
        ...withNext,
        plan: 'build-and-serve',
        build: run('build'),
        ...(serveScript === undefined ? {} : { serve: serveScript }),
        summary: `run ${run('build')}, start the site with ${serveScript}, and crawl the pages its build lists`,
      }
    }
    const shell = await sourceIsShell(cwd)
    return {
      ...base,
      ...withNext,
      plan: 'build',
      build: run('build'),
      ...(expected === undefined ? {} : { directory: expected }),
      ...(serveScript === undefined ? {} : { serve: serveScript }),
      ...(shell ? { appShell: true as const } : {}),
      summary:
        (expected === undefined
          ? `run ${run('build')} and audit what it writes`
          : `run ${run('build')} and audit what it writes, expected in ${expected}/`) +
        (shell ? ', which is an empty app shell until JavaScript runs: add --browser' : ''),
    }
  }

  if (serveScript !== undefined) {
    return {
      ...base,
      ...withNext,
      plan: 'serve',
      serve: serveScript,
      summary: `start the site with ${serveScript} and crawl it`,
    }
  }
  return { ...base, summary: 'do nothing: there is no build, and no script to build or serve one' }
}

async function readNext(cwd: string): Promise<ProjectDetection['next']> {
  const { nextRoutes, readNextConfig } = await import('./next.ts')
  const config = await readNextConfig(cwd)
  const routes = await nextRoutes(cwd)
  return {
    ...(config.output === undefined ? {} : { output: config.output }),
    ...(config.basePath === undefined ? {} : { basePath: config.basePath }),
    pages: routes?.pages.length ?? 0,
    dynamic: routes?.dynamic ?? [],
  }
}

/** Whether the index.html a Vite-style build starts from is an empty shell. */
async function sourceIsShell(cwd: string): Promise<boolean> {
  const { readFile } = await import('node:fs/promises')
  const { isAppShell } = await import('./shell.ts')
  try {
    return isAppShell(await readFile(path.join(cwd, 'index.html'), 'utf8'))
  } catch {
    return false
  }
}
