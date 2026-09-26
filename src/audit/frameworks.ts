import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { exists } from '../fs.ts'

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
  /**
   * A file that identifies it only by what it says, for a name two tools share:
   * Zola and Hugo both read `config.toml`, and only Zola's has `base_url`.
   */
  contents?: { file: string; pattern: RegExp }
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
  /**
   * What to run to get the site serving, for projects that never write HTML at
   * all.
   *
   * A CMS has no build directory, so "no HTML found in ./dist" is not a
   * misconfiguration to correct — there was never going to be any. `outputs` is
   * empty for these, and this is what the advice names instead: the command
   * that gets the site up, so `--url` has something to point at.
   */
  serveCommand?: string
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
    id: 'qwik',
    name: 'Qwik',
    packages: ['@builder.io/qwik-city', '@qwik.dev/router'],
    outputs: ['dist'],
    staticOutput: {
      needs: 'the static adapter',
      how: 'run npm run qwik add static, then build',
    },
    serves: true,
  },
  {
    id: 'solidstart',
    name: 'SolidStart',
    packages: ['@solidjs/start'],
    outputs: ['.output/public', 'dist'],
    serves: true,
  },
  {
    id: 'tanstack-start',
    name: 'TanStack Start',
    packages: ['@tanstack/react-start', '@tanstack/solid-start'],
    outputs: ['.output/public', 'dist/client'],
    serves: true,
  },
  {
    id: 'analog',
    name: 'Analog',
    packages: ['@analogjs/platform'],
    outputs: ['dist/analog/public'],
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
    id: 'hexo',
    name: 'Hexo',
    packages: ['hexo'],
    outputs: ['public'],
    configs: ['_config.yml'],
    outputPattern: /^public_dir:\s*['"]?([^'"\s#]+)/m,
    serves: false,
  },
  {
    id: 'mkdocs',
    name: 'MkDocs',
    packages: [],
    files: ['mkdocs.yml', 'mkdocs.yaml'],
    outputs: ['site'],
    configs: ['mkdocs.yml', 'mkdocs.yaml'],
    outputPattern: /^site_dir:\s*['"]?([^'"\s#]+)/m,
    serves: false,
  },
  {
    id: 'sphinx',
    name: 'Sphinx',
    packages: [],
    files: ['conf.py', 'docs/conf.py', 'doc/conf.py', 'source/conf.py', 'docs/source/conf.py'],
    outputs: [
      '_build/html',
      'docs/_build/html',
      'build/html',
      'docs/build/html',
      'doc/_build/html',
    ],
    serves: false,
  },
  {
    id: 'mdbook',
    name: 'mdBook',
    packages: [],
    files: ['book.toml'],
    outputs: ['book'],
    configs: ['book.toml'],
    outputPattern: /build-dir\s*=\s*['"]([^'"]+)['"]/,
    serves: false,
  },
  {
    id: 'quarto',
    name: 'Quarto',
    packages: [],
    files: ['_quarto.yml', '_quarto.yaml'],
    outputs: ['_site'],
    configs: ['_quarto.yml', '_quarto.yaml'],
    outputPattern: /output-dir:\s*['"]?([^'"\s#]+)/,
    serves: false,
  },
  {
    id: 'pelican',
    name: 'Pelican',
    packages: [],
    files: ['pelicanconf.py'],
    outputs: ['output'],
    configs: ['pelicanconf.py', 'publishconf.py'],
    outputPattern: /OUTPUT_PATH\s*=\s*['"]([^'"]+)['"]/,
    serves: false,
  },
  {
    // Before Hugo: both read config.toml, and only Zola's says base_url.
    id: 'zola',
    name: 'Zola',
    packages: [],
    files: ['zola.toml'],
    contents: { file: 'config.toml', pattern: /^\s*base_url\s*=/m },
    outputs: ['public'],
    serves: false,
  },
  {
    id: 'hugo',
    name: 'Hugo',
    packages: [],
    files: ['hugo.toml', 'hugo.yaml', 'hugo.json', 'config.toml', 'config/_default'],
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
  // Everything below renders on a server and writes no browsable HTML to disk.
  // They are identified by a file rather than a dependency because their
  // package.json, where there is one, belongs to a theme's asset build and says
  // nothing about the CMS around it — and they are ordered ahead of Vite for
  // exactly that reason: a WordPress theme bundled with Vite is a WordPress
  // site, and auditing the folder Vite filled would audit its stylesheets.
  {
    id: 'wordpress',
    name: 'WordPress',
    packages: [],
    files: ['wp-config.php', 'wp-config-sample.php', 'wp-load.php'],
    outputs: [],
    serves: true,
    serveCommand: 'wp-env start, ddev start, or whichever local stack this site uses',
  },
  {
    id: 'typo3',
    name: 'TYPO3',
    packages: [],
    files: ['typo3conf', 'public/typo3conf', 'typo3'],
    outputs: [],
    serves: true,
    serveCommand: 'ddev start, or your usual local stack',
  },
  {
    id: 'craft',
    name: 'Craft CMS',
    packages: [],
    files: ['craft'],
    outputs: [],
    serves: true,
    serveCommand: 'ddev start, or php craft serve',
  },
  {
    id: 'drupal',
    name: 'Drupal',
    packages: [],
    files: ['core/lib/Drupal.php', 'web/core/lib/Drupal.php', 'docroot/core/lib/Drupal.php'],
    outputs: [],
    serves: true,
    serveCommand: 'ddev start, or drush runserver',
  },
  {
    // Before Laravel: a Statamic site is a Laravel app too, and has artisan.
    id: 'statamic',
    name: 'Statamic',
    packages: [],
    files: ['please'],
    outputs: [],
    serves: true,
    serveCommand: 'php artisan serve',
  },
  {
    id: 'laravel',
    name: 'Laravel',
    packages: [],
    files: ['artisan'],
    outputs: [],
    serves: true,
    serveCommand: 'php artisan serve',
  },
  {
    id: 'symfony',
    name: 'Symfony',
    packages: [],
    files: ['bin/console', 'symfony.lock'],
    outputs: [],
    serves: true,
    serveCommand: 'symfony serve, or php -S localhost:8000 -t public',
  },
  {
    id: 'rails',
    name: 'Ruby on Rails',
    packages: [],
    files: ['bin/rails', 'config.ru'],
    outputs: [],
    serves: true,
    serveCommand: 'bin/rails server',
  },
  {
    id: 'django',
    name: 'Django',
    packages: [],
    files: ['manage.py'],
    outputs: [],
    serves: true,
    serveCommand: 'python manage.py runserver',
  },
  {
    id: 'ghost',
    name: 'Ghost theme',
    packages: [],
    files: ['default.hbs'],
    outputs: [],
    serves: true,
    serveCommand: 'ghost start, in the Ghost install this theme belongs to',
  },
  {
    id: 'shopify',
    name: 'Shopify theme',
    packages: [],
    files: ['layout/theme.liquid'],
    outputs: [],
    serves: true,
    serveCommand: 'shopify theme dev',
  },
  // Bundlers, after everything that might use one: a Vue CLI or Parcel build in
  // a CMS theme is that CMS's asset pipeline, not the site.
  {
    id: 'vue-cli',
    name: 'Vue CLI',
    packages: ['@vue/cli-service'],
    outputs: ['dist'],
    configs: ['vue.config.js', 'vue.config.mjs', 'vue.config.ts'],
    outputPattern: /outputDir\s*:\s*['"`]([^'"`]+)['"`]/,
    serves: false,
  },
  {
    id: 'ember',
    name: 'Ember',
    packages: ['ember-cli'],
    outputs: ['dist'],
    serves: false,
  },
  {
    id: 'parcel',
    name: 'Parcel',
    packages: ['parcel'],
    outputs: ['dist'],
    serves: false,
  },
  {
    id: 'rsbuild',
    name: 'Rsbuild',
    packages: ['@rsbuild/core'],
    outputs: ['dist'],
    serves: false,
  },
  {
    id: 'rspack',
    name: 'Rspack',
    packages: ['@rspack/cli', '@rspack/core'],
    outputs: ['dist'],
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
  /** Why it was recognised, in words, for `eaa-kit detect`. */
  evidence: string[]
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
    const evidence = await identify(cwd, framework, deps)
    if (evidence === undefined) continue

    const configured = await configuredOutput(cwd, framework)
    // Configured first, then the defaults: a project that moved its output
    // still usually has the default directory lying around from before.
    const outputs =
      configured === undefined ? [...framework.outputs] : [configured.output, ...framework.outputs]
    return {
      framework,
      outputs: [...new Set(outputs)],
      evidence: [
        evidence,
        ...(configured === undefined
          ? []
          : [`${configured.file} sets the output to ${configured.output}/`]),
      ],
    }
  }
  return undefined
}

/** What identifies this framework here, in words, or undefined if nothing does. */
async function identify(
  cwd: string,
  framework: Framework,
  deps: Record<string, string>,
): Promise<string | undefined> {
  const dependency = framework.packages.find((name) => deps[name] !== undefined)
  if (dependency !== undefined) return `package.json depends on ${dependency}`
  for (const file of framework.files ?? []) {
    if (await exists(file, cwd)) return `found ${file}`
  }
  if (framework.contents !== undefined) {
    const { file, pattern } = framework.contents
    try {
      if (pattern.test(await readFile(path.resolve(cwd, file), 'utf8'))) {
        return `${file} is ${article(framework.name)} ${framework.name} config`
      }
    } catch {
      // not there
    }
  }
  return undefined
}

function article(name: string): string {
  return /^[AEFHILMNORSX]/.test(name) ? 'an' : 'a'
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
  return (await configuredOutput(cwd, framework))?.output
}

async function configuredOutput(
  cwd: string,
  framework: Framework,
): Promise<{ file: string; output: string } | undefined> {
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
    return { file: name, output: value.replace(/^\.\//, '').replace(/\/$/, '') }
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
