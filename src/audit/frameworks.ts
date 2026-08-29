import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * What this tool knows about the things that build websites.
 *
 * Three modules used to hold three different lists: a flat array of output
 * directories, a five-name dependency check, and a set of route conventions.
 * They disagreed, none of them knew that `out/` belongs to Next.js and `_site/`
 * to Eleventy, and the advice for an empty build directory covered two
 * frameworks out of everything people actually use.
 *
 * One registry instead. Each entry states how to recognise the framework, where
 * it writes browsable HTML, whether that takes extra configuration, and whether
 * it can serve pages it never writes to disk — which is the fact that decides
 * whether `--url` is the answer.
 */

export interface Framework {
  id: string
  /** How to name it in a message. */
  name: string
  /** Dependencies that identify it, in package.json. */
  packages: readonly string[]
  /** Files that identify it, for the ones that are not npm packages. */
  files?: readonly string[]
  /** Where it writes browsable HTML, best candidate first. */
  outputs: readonly string[]
  /**
   * Config files to read a custom output directory out of, with the pattern
   * that finds it. Read rather than executed: a config file is code, and this
   * runs before anything has decided the project is trustworthy.
   */
  configs?: readonly string[]
  outputPattern?: RegExp
  /**
   * What static output takes, when it is not the default. Named because
   * "no HTML found" is unhelpful next to a framework that needs one line of
   * config to produce any.
   */
  staticOutput?: { needs: string; how: string }
  /**
   * Whether it can serve pages without writing them to disk. True means `--url`
   * is a real answer for this project rather than a consolation.
   */
  serves: boolean
}

/**
 * Most specific first. Several of these depend on Vite, so Vite is last: a
 * SvelteKit project is a SvelteKit project, not a Vite one.
 *
 * Several carry `files` as well as `packages` even though they are npm
 * packages. A config file named after the framework is as good an identifier as
 * the dependency, and it still works where package.json is missing, unreadable,
 * or belongs to a workspace root rather than the project in front of us.
 */
export const FRAMEWORKS: readonly Framework[] = [
  {
    id: 'next',
    name: 'Next.js',
    packages: ['next'],
    files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    outputs: ['out'],
    configs: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
    outputPattern: /distDir\s*:\s*['"`]([^'"`]+)['"`]/,
    staticOutput: {
      needs: "output: 'export'",
      how: "add output: 'export' to your Next config, then build",
    },
    serves: true,
  },
  {
    id: 'nuxt',
    name: 'Nuxt',
    packages: ['nuxt'],
    files: ['nuxt.config.ts', 'nuxt.config.js'],
    outputs: ['.output/public', 'dist'],
    staticOutput: { needs: 'nuxt generate', how: 'run nuxt generate rather than nuxt build' },
    serves: true,
  },
  {
    id: 'sveltekit',
    name: 'SvelteKit',
    packages: ['@sveltejs/kit'],
    files: ['svelte.config.js'],
    outputs: ['build', '.svelte-kit/output/prerendered/pages'],
    staticOutput: {
      needs: '@sveltejs/adapter-static',
      how: 'use @sveltejs/adapter-static, then build',
    },
    serves: true,
  },
  {
    id: 'remix',
    name: 'React Router / Remix',
    packages: ['@remix-run/react', 'react-router', '@react-router/dev'],
    outputs: ['build/client'],
    serves: true,
  },
  {
    id: 'astro',
    name: 'Astro',
    packages: ['astro'],
    files: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
    outputs: ['dist'],
    configs: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
    outputPattern: /outDir\s*:\s*['"`]([^'"`]+)['"`]/,
    serves: true,
  },
  {
    id: 'gatsby',
    name: 'Gatsby',
    packages: ['gatsby'],
    outputs: ['public'],
    serves: false,
  },
  {
    id: 'docusaurus',
    name: 'Docusaurus',
    packages: ['@docusaurus/core'],
    outputs: ['build'],
    serves: false,
  },
  {
    id: 'vitepress',
    name: 'VitePress',
    packages: ['vitepress'],
    files: ['.vitepress/config.ts', 'docs/.vitepress/config.ts'],
    outputs: ['.vitepress/dist', 'docs/.vitepress/dist'],
    serves: false,
  },
  {
    id: 'eleventy',
    name: 'Eleventy',
    packages: ['@11ty/eleventy'],
    outputs: ['_site'],
    configs: ['.eleventy.js', 'eleventy.config.js', 'eleventy.config.mjs'],
    outputPattern: /output\s*:\s*['"`]([^'"`]+)['"`]/,
    serves: false,
  },
  {
    id: 'angular',
    name: 'Angular',
    packages: ['@angular/core'],
    // Angular writes dist/<project>/browser; the glob finds HTML either way.
    outputs: ['dist'],
    serves: false,
  },
  {
    id: 'cra',
    name: 'Create React App',
    packages: ['react-scripts'],
    outputs: ['build'],
    serves: false,
  },
  {
    id: 'hugo',
    name: 'Hugo',
    packages: [],
    files: ['hugo.toml', 'hugo.yaml', 'config.toml'],
    outputs: ['public'],
    serves: false,
  },
  {
    id: 'jekyll',
    name: 'Jekyll',
    packages: [],
    files: ['_config.yml'],
    outputs: ['_site'],
    serves: false,
  },
  {
    id: 'vite',
    name: 'Vite',
    packages: ['vite'],
    outputs: ['dist'],
    configs: ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'],
    outputPattern: /outDir\s*:\s*['"`]([^'"`]+)['"`]/,
    serves: true,
  },
]

/** Output directories to try when nothing was recognised. */
export const FALLBACK_OUTPUTS = [
  'dist',
  'out',
  'build',
  '_site',
  'public',
  '.output/public',
] as const

export interface DetectedFramework {
  framework: Framework
  /**
   * Output directories to try, most likely first: any read out of the config,
   * then the framework's defaults.
   */
  outputs: string[]
}

async function exists(root: string, name: string): Promise<boolean> {
  try {
    await stat(path.resolve(root, name))
    return true
  } catch {
    return false
  }
}

/**
 * The framework this project uses, if it is one this knows.
 *
 * Dependencies decide it where there are any, because a package.json states
 * what a project is far more reliably than a file lying in the root. The
 * file-based entries exist for Hugo and Jekyll, which have no package.json to
 * read.
 */
export async function detectFramework(
  cwd: string,
  pkg?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): Promise<DetectedFramework | undefined> {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }

  for (const framework of FRAMEWORKS) {
    const byPackage = framework.packages.some((name) => deps[name] !== undefined)
    let byFile = false
    if (!byPackage && framework.files !== undefined) {
      for (const file of framework.files) {
        if (await exists(cwd, file)) {
          byFile = true
          break
        }
      }
    }
    if (!byPackage && !byFile) continue

    const configured = await outputFromConfig(cwd, framework)
    // Configured first, then the defaults: a project that moved its output
    // still usually has the default directory lying around from before.
    const outputs =
      configured === undefined ? [...framework.outputs] : [configured, ...framework.outputs]
    return { framework, outputs: [...new Set(outputs)] }
  }
  return undefined
}

/**
 * A custom output directory, read out of the framework's config file.
 *
 * Read with a pattern rather than executed. A config file is code, and this runs
 * before anything has decided the project is worth trusting; a regex that
 * misses a computed value is a directory not found, which the caller already
 * handles, while running the file to find out is a different class of risk
 * entirely.
 */
export async function outputFromConfig(
  cwd: string,
  framework: Framework,
): Promise<string | undefined> {
  if (framework.configs === undefined || framework.outputPattern === undefined) return undefined
  for (const name of framework.configs) {
    let source: string
    try {
      source = await readFile(path.resolve(cwd, name), 'utf8')
    } catch {
      continue
    }
    const found = framework.outputPattern.exec(source)
    const value = found?.[1]
    if (value === undefined || value === '') continue
    // Relative to the project. An absolute one is somebody's machine, not a
    // fact about the project, and joining it would produce nonsense.
    if (path.isAbsolute(value)) continue
    return value.replace(/^\.\//, '')
  }
  return undefined
}

/** Every output directory worth trying, framework-aware, most likely first. */
export async function candidateOutputs(
  cwd: string,
  pkg?: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): Promise<string[]> {
  const detected = await detectFramework(cwd, pkg)
  return [...new Set([...(detected?.outputs ?? []), ...FALLBACK_OUTPUTS])]
}
