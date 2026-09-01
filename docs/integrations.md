# Integrations

Ways to run eaa-kit as part of a build rather than by hand. Every one of them reaches the
same point — a finished build in a directory that has to be judged before the build may
proceed — and shares one decision function, so they cannot drift into disagreeing about
what a passing build is. Only the hook name and the logger differ.

None of them adds a dependency: each describes the shape of its host structurally, so
installing eaa-kit in a project that has no Astro, no webpack and no Nuxt costs nothing and
still typechecks.

## Astro integration

`astro build` already knows where the output went and when it finished, which is the one
moment a build-time auditor wants. Wiring the CLI into a project's scripts works, but it
means remembering to, and it means the audit is a separate step that is easy to drop from
a pipeline when it goes red.

```bash
pnpm add -D eaa-kit
```

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config'
import eaaKit from 'eaa-kit/astro'

export default defineConfig({
  integrations: [eaaKit()],
})
```

That audits `dist/` at the end of every `astro build`, prints the same report the CLI
prints, and fails the build on violations at or above the threshold.

| Option | Default | Meaning |
| --- | --- | --- |
| `failOn` | `'serious'` | Lowest impact that fails the build |
| `failBuild` | `true` | Whether a failing audit fails the build at all |
| `enabled` | `true` | Set false to skip the audit entirely |
| `baseline` | — | Accept the violations in this file; fail only on new ones |
| `format`, `output` | — | Also write a report, as `--format` and `--output` do |
| `include`, `exclude`, `baseUrl`, `browser`, `concurrency` | | As for `audit` |

Failing the build by default is the point: an auditor that only ever prints is one nobody
reads. `failBuild: false` exists for the week it takes to adopt the tool on a site that
already exists — after that, a [baseline](baseline.md) is the honest way to go green,
because it records what is wrong instead of hiding it.

```ts
integrations: [eaaKit({ baseline: 'eaa-baseline.json' })]
```

Astro is an optional peer dependency. It is never imported at runtime — the integration
describes the two shapes it needs structurally, so installing eaa-kit in a project that is
not an Astro project costs nothing and typechecks fine. The test suite drives a real
`astro build` to make sure that stand-in has not drifted from the API it stands in for.

A build the audit could not complete — no HTML in the output, a page nothing could read, a
baseline that is not there — fails the build too, but says so in those words. It is not a
failing audit; it is a build that was never checked, and reporting it as violations would
send somebody looking for defects that were never measured.

## Eleventy plugin

```js
// eleventy.config.js
import eaaKit from 'eaa-kit/eleventy'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(eaaKit)
  // or, configured:
  // eleventyConfig.addPlugin(eaaKit, { failOn: 'moderate' })
}
```

Audits in `eleventy.after`, which fires once the files are written and hands over the output
directory — worth having here more than for most builders, since Eleventy's is configurable
and the audit would otherwise be guessing at `_site`.

## webpack plugin

```js
// webpack.config.js
const EaaKitPlugin = require('eaa-kit/webpack').default

module.exports = {
  plugins: [new EaaKitPlugin({ failOn: 'serious' })],
}
```

Audits in `afterEmit`, the first hook at which every file is on disk. Watch rebuilds are
skipped: auditing a whole site on every keystroke would make a dev server unusable, and a
failing audit there cannot stop anything being shipped anyway. A build that already failed
is skipped too — it has no output worth judging, and reporting missing pages as
accessibility findings would send somebody after defects nothing ever measured.

Worth having even though webpack is not a site generator: it is what Create React App,
ejected setups and a long tail of bespoke pipelines run, and none of them is covered by the
Vite plugin.

## Nuxt module

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [['eaa-kit/nuxt', { failOn: 'serious' }]],
})
```

Nuxt builds on Vite, so [the Vite plugin](#vite-plugin) already runs in a Nuxt project.
This module exists because it runs at the wrong moment and against the wrong directory.
All three points below were measured against a real `nuxt generate`, which drives this
module in the test suite.

**When.** Vite's `closeBundle` fires when Vite has finished, and Nitro prerenders after
that. At `build:done` the public directory does not exist at all; by `close` it holds every
prerendered page. The module audits in `close`.

**Where.** The output directory is not on `nuxt.options.nitro.output` — that is undefined
throughout a build. Nitro resolves it onto its own instance, which reaches a module through
the `nitro:init` hook.

**What.** `nuxt build` produces a server: `.output/public` exists and holds assets with no
page among them. Auditing it would find nothing and report success, which is the worst
outcome available, so a server build is told what it is instead. Pass
`allowServerBuild: true` where that is expected and the audit should stand down, or
`directory` to name a path yourself.

## Vite plugin

Covers Vite itself and everything built on it — SvelteKit, Nuxt, Remix, and Astro if you
would rather configure it there than through the Astro integration.

```bash
pnpm add -D eaa-kit
```

```js
// vite.config.js
import eaaKit from 'eaa-kit/vite'

export default {
  plugins: [eaaKit()],
}
```

The audit runs in `closeBundle`, after the build has written its files, and fails the build
on violations at or above the threshold. It is `apply: 'build'`, so a dev server never
waits on it, and `enforce: 'post'`, so a plugin still emitting pages is not audited by its
absence.

| Option | |
| --- | --- |
| `failOn` | lowest impact that fails the build (default `serious`) |
| `failBuild: false` | report without failing — for the week it takes to adopt this on a site that already exists |
| `enabled: false` | skip entirely, for turning it off per environment without unwiring it |
| `directory` | audit somewhere other than the build's `outDir` |
| `browser`, `baseline`, `include`, `exclude`, `format`, `output` | as the CLI |

`outDir` is read from the resolved Vite config, so a project that moved its output needs no
second place to say so.

## Docusaurus

**There is no Docusaurus plugin, deliberately.** The hook is perfect — `postBuild` runs
when the whole site is on disk and hands over `outDir` — and one was written against it and
then withdrawn before release, because it does not survive the way Docusaurus loads it.

Docusaurus loads plugins through jiti, which intercepts dynamic `import()`. axe-core
reaches jiti's module evaluator instead of Node's and is evaluated without the globals it
expects, so the audit dies on `Cannot read properties of undefined (reading 'document')` —
in `postBuild`, at the end of a build that otherwise succeeded. Nothing in the plugin's own
code is wrong, which is why it passed its unit tests: those call the plugin directly, and
jiti is never in the picture.

A command instead, which always works:

```bash
docusaurus build && eaa-kit audit
```

`eaa-kit audit` with no argument recognises a Docusaurus project and knows its output goes
to `build/`, so the directory does not have to be repeated. In `package.json`:

```json
{
  "scripts": {
    "build": "docusaurus build && eaa-kit audit --fail-on serious"
  }
}
```

Docs sites are worth auditing more than most — docs are where an organisation's own
accessibility claims usually live, they are generated from Markdown by machinery nobody on
the team wrote, and nobody opens every page. The audit itself is unaffected: a built
Docusaurus site is detected as one, and its pages are mapped back to `docs/**/*.md` under
the site's base path.

## Next.js

**There is no Next.js plugin, deliberately.** Next has no stable hook that runs after a
build writes its files: `next.config.js`'s `webpack` function is the usual place, and Next
16 defaults to Turbopack, which does not call it. A plugin built that way would look wired
up in the config and silently never run — which for an accessibility check is worse than
having none.

Two commands instead, both of which always work:

```bash
next build && eaa-kit audit
```

or simply

```bash
eaa-kit audit
```

which finds the build, runs it if there is none, and — for a site with API routes or
middleware, which cannot be exported statically — starts the server and audits what it
serves. See [Which directory to point it at](audit.md#which-directory-to-point-it-at).

## GitHub Actions

A composite action is included. It builds the site, audits it, uploads the SARIF log to
code scanning, and then fails the job — in that order, so the alerts are in place even
when the audit fails.

```yaml
name: Accessibility

on: [push, pull_request]

permissions:
  contents: read
  # Required by the SARIF upload. Without it the upload fails with
  # "Resource not accessible by integration".
  security-events: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: likeBloodMoon/eaa-kit@v0.4.0
        with:
          install-command: npm ci
          build-command: npm run build
          directory: ./dist
          fail-on: serious
```

A runnable copy lives in [.github/workflows/accessibility.yml](../.github/workflows/accessibility.yml).

Pin the action to an exact release tag, as above. There is deliberately no moving `v0` or
`v1` tag to follow: this is a 0.x package, the flags and the JSON contract can still move
between releases, and an action that silently updates itself under a build you are not
watching is the wrong default for something whose job is to fail that build.

### Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `directory` | `./dist` | Directory holding the built site |
| `build-command` | — | Command that produces the build; omit if an earlier step builds it |
| `install-command` | — | Dependency install, run before `build-command` |
| `working-directory` | `.` | Where to run install, build and audit |
| `fail-on` | `serious` | Lowest impact that fails the run |
| `base-url` | — | Audit pages under their real site URL |
| `sarif-file` | `eaa-kit.sarif` | Where to write the SARIF log |
| `upload-sarif` | `true` | Upload to GitHub code scanning |
| `sitemap` | — | Where the site lists its pages, if not `/sitemap.xml`; with `url` only |
| `baseline` | — | Path to a baseline file; fail only on violations it does not list |
| `concurrency` | from page and core count | Worker threads for the browserless engine; `1` for none |
| `version` | `latest` | Version of eaa-kit to run |

### Outputs

| Output | Meaning |
| --- | --- |
| `sarif-file` | Path to the SARIF log that was written |
| `exit-code` | `0` clean, `1` violations, `2` could not run |

An audit that exits `2` never produced a verdict, so no SARIF is written and the upload is
skipped; the job fails either way.

### Without the action

The audit still writes its SARIF log when it finds violations, so the upload has to run
before the job is allowed to fail:

```yaml
- name: Audit
  id: audit
  run: npx eaa-kit audit ./dist --format sarif --output a11y.sarif
  continue-on-error: true

- uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: a11y.sarif
    category: eaa-kit

- name: Fail on findings
  if: steps.audit.outcome == 'failure'
  run: exit 1
```

Keeping the JSON report as a build artefact alongside it is often worth it, since it
carries the categories SARIF leaves out:

```yaml
- run: npx eaa-kit audit ./dist --format json --output a11y.json
  continue-on-error: true
- uses: actions/upload-artifact@v4
  with:
    name: accessibility-report
    path: a11y.json
```
