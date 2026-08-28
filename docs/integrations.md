# Integrations

Two ways to run eaa-kit as part of a build rather than by hand.

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
      - uses: likeBloodMoon/eaa-kit@v0.1.0
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
