import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'tinyglobby'
import { exists, toPosix } from '../fs.ts'
import { type DetectedFramework, detectFramework } from './frameworks.ts'
import { readPackageJson } from './project.ts'

/**
 * The sites in a monorepo.
 *
 * Run from the root of a pnpm, yarn or npm workspace, the tool used to see the
 * root's package.json, which usually depends on Turborepo and nothing else, and
 * conclude there was nothing here to audit. The sites are one level down, in
 * `apps/*` or wherever the workspace says, and each of them is an ordinary
 * project that everything else here already knows how to handle.
 */

export interface WorkspaceSite {
  /** The package's directory, relative to the root, with forward slashes. */
  dir: string
  framework: DetectedFramework
}

export interface WorkspaceScan {
  /** The file that made this a workspace, e.g. `pnpm-workspace.yaml`. */
  evidence: string
  /** The packages that are sites, sorted by directory. */
  sites: WorkspaceSite[]
}

/** Where Turborepo and Nx put things by convention, when nothing else says. */
const CONVENTIONAL = ['apps/*', 'packages/*']

/** Undefined when `root` is not the root of a workspace. */
export async function findWorkspaceSites(root: string): Promise<WorkspaceScan | undefined> {
  const listed = await workspaceGlobs(root)
  if (listed === undefined) return undefined

  // `!apps/legacy` excludes a package from the workspace, in pnpm's list and in
  // package.json's alike, and an excluded package is not one of its sites.
  const trim = (pattern: string): string => pattern.replace(/^!/, '').replace(/\/$/, '')
  const included = listed.globs.filter((pattern) => !pattern.startsWith('!'))
  const excluded = listed.globs.filter((pattern) => pattern.startsWith('!'))
  const manifests = await glob(
    included.map((pattern) => `${trim(pattern)}/package.json`),
    {
      cwd: root,
      ignore: [
        '**/node_modules/**',
        ...excluded.flatMap((pattern) => [`${trim(pattern)}/package.json`, `${trim(pattern)}/**`]),
      ],
      onlyFiles: true,
      dot: false,
    },
  )

  const sites: WorkspaceSite[] = []
  for (const manifest of manifests.sort()) {
    const dir = path.dirname(manifest)
    if (dir === '.') continue
    const absolute = path.join(root, dir)
    const framework = await detectFramework(absolute, await readPackageJson(absolute))
    if (framework === undefined) continue
    // Vite builds libraries as well as apps, and a component library is not a
    // site. An app has the index.html Vite starts from.
    if (framework.framework.id === 'vite' && !(await exists(path.join(absolute, 'index.html')))) {
      continue
    }
    sites.push({ dir: toPosix(dir), framework })
  }
  return { evidence: listed.evidence, sites }
}

async function workspaceGlobs(
  root: string,
): Promise<{ evidence: string; globs: string[] } | undefined> {
  const pnpm = await readText(path.join(root, 'pnpm-workspace.yaml'))
  if (pnpm !== undefined) {
    return { evidence: 'pnpm-workspace.yaml', globs: yamlPackages(pnpm) }
  }

  const pkg = await readPackageJson(root)
  const workspaces = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages
  if (workspaces !== undefined && workspaces.length > 0) {
    return { evidence: 'package.json workspaces', globs: workspaces }
  }

  const lerna = await readText(path.join(root, 'lerna.json'))
  if (lerna !== undefined) {
    try {
      const packages = (JSON.parse(lerna) as { packages?: string[] }).packages
      return { evidence: 'lerna.json', globs: packages ?? CONVENTIONAL }
    } catch {
      return { evidence: 'lerna.json', globs: CONVENTIONAL }
    }
  }

  for (const marker of ['turbo.json', 'nx.json']) {
    if (await exists(path.join(root, marker))) return { evidence: marker, globs: CONVENTIONAL }
  }
  return undefined
}

/**
 * The `packages:` list out of pnpm-workspace.yaml, read with a pattern. It is a
 * list of strings, and a YAML parser would be a dependency for one list.
 * Negated entries are kept: they are exclusions, applied when scanning.
 */
function yamlPackages(source: string): string[] {
  const block = /^packages:\s*\n((?:[ \t]*(?:-.*|#.*)?\n?)*)/m.exec(source)?.[1] ?? ''
  return [...block.matchAll(/^[ \t]*-[ \t]*['"]?([^'"\n#]+?)['"]?[ \t]*(?:#.*)?$/gm)]
    .map((match) => match[1] ?? '')
    .filter((entry) => entry !== '')
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return undefined
  }
}
