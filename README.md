# eaa-kit

Build-time WCAG 2.2 AA auditor for static sites, aimed at freelancers and small agencies in
the DACH region who have to comply with the European Accessibility Act (in force since
28 June 2025), the BFSG in Germany and the BaFG in Austria.

```bash
npx eaa-kit audit ./dist
```

An accessibility statement generator (`eaa-kit statement`) is in progress and not usable yet.

> **Not legal advice.** eaa-kit reports what an automated engine can and cannot determine
> about your markup. Automated testing catches a minority of accessibility barriers; it is
> a floor, not a certificate.

## Install

```bash
pnpm add -D eaa-kit    # npm i -D eaa-kit
```

Node 20 or newer.

## audit

```bash
eaa-kit audit [dir]              # dir defaults to ./dist
```

Real output, auditing a 4-page Astro build:

```
eaa-kit audit 4 pages · jsdom (browserless)
passed = checked and met · not applicable = nothing to check

404.html
  ✓ no violations
    17 passed · 41 not applicable · 5 not evaluated

datenschutz/index.html
  ✓ no violations
    19 passed · 39 not applicable · 5 not evaluated

impressum/index.html
  ✓ no violations
    19 passed · 39 not applicable · 5 not evaluated

index.html
  ✓ no violations
    22 passed · 35 not applicable · 6 not evaluated

Summary
  No violations across 4 pages.

Not evaluated
  This engine reached no verdict on these.
  They are never reported as passing.
  · color-contrast 4 pages, WCAG 1.4.3
      needs rendered foreground and background colours
  · link-in-text-block 4 pages, WCAG 1.4.1
      needs rendered colours and text decoration
  · no-autoplay-audio 4 pages, WCAG 1.4.2
      needs media duration, and media is never loaded
  · scrollable-region-focusable 4 pages, WCAG 2.1.1 2.1.3
      needs computed overflow
  · target-size 4 pages, WCAG 2.5.8
      needs element geometry; every box is 0x0 without layout
  · avoid-inline-spacing 1 page, WCAG 1.4.12
      needs computed spacing after the full cascade
```

The report goes to stdout and progress goes to stderr, so it can be piped without the
chatter coming along.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--include <globs...>` | `**/*.html`, `**/*.htm` | Glob patterns to audit, relative to `dir` |
| `--exclude <globs...>` | `node_modules`, `.git` | Glob patterns to skip |
| `--base-url <url>` | — | Audit pages under their real site URL instead of `file://` |
| `--fail-on <impact>` | `serious` | Lowest impact that fails the run |
| `--format <format>` | `console` | `console`, `json`, or `sarif` |
| `--output <path>` | stdout | Write the report to a file; parent directories are created |

Dot directories such as build caches are skipped by default. `--include` and `--exclude`
replace the defaults rather than adding to them.

#### `--fail-on <impact>`

`minor`, `moderate`, `serious` (default) or `critical`. Any violation at or above the
level fails the run. The same audit against the deployed site rather than the local build:

```
index.html
  ✗ frame-title serious, WCAG 4.1.2
      Frames must have an accessible name
      iframe
        <iframe src="https://maps.example.c..." loading="lazy" referrerpolicy="no…
  ✗ link-name serious, WCAG 2.4.4 4.1.2
      Links must have discernible text
      .social-link
        <a href="https://social.example.com/profile" class="social-link" target="_bl…
  ? video-caption needs manual review, WCAG 1.2.2
    18 passed · 38 not applicable · 1 to review · 5 not evaluated

Summary
  2 violations on 1 of 1 page (2 elements)
  2 at or above serious (--fail-on serious)
  1 rule needs manual review
```

That run exits 1. With `--fail-on critical` it exits 0, and the summary says so rather
than leaving you to guess why a report full of findings passed:

```
  none at or above critical (--fail-on critical), so this run passes
```

A violation axe-core did not classify counts at every threshold. A missing impact is a gap
in what we know, not evidence that the failure is harmless.

#### `--base-url <url>`

Without it, pages are audited under a `file://` URL derived from their path. With
`--base-url https://example.com`, `about/index.html` is audited as
`https://example.com/about/index.html`, which is how relative links resolve in the report
and in the JSON document's `url` field.

#### `--format` and `--output`

`--format` selects what is produced; `--output` decides where it goes. Colour is dropped
when the console format is written to a file.

```bash
eaa-kit audit ./dist                                      # console, to the terminal
eaa-kit audit ./dist --format json --output a11y.json     # JSON, to a file
eaa-kit audit ./dist --format sarif --output a11y.sarif   # SARIF, for code scanning
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No violations at or above `--fail-on` |
| `1` | At least one violation at or above `--fail-on` |
| `2` | The audit could not run or could not finish: missing build directory, no HTML found, a page that could not be audited, or a usage error such as an unknown flag |

A page that could not be audited exits `2` rather than `0`. It is neither clean nor
failing, and reporting a pass for markup nothing read would be worse than reporting a
broken run.

## What the browserless engine can and cannot tell you

By default eaa-kit globs the HTML out of your build directory, parses it with jsdom and
runs axe-core against the resulting DOM. No Chromium download, fast enough for CI, and it
never fetches anything or executes your site's JavaScript.

The cost is that jsdom has no layout. Every element reports a 0×0 box and computed style
is limited to the inline cascade, so rules that depend on rendering cannot be decided.
axe-core does not know that and will report some of them as **passing** — `target-size`
(WCAG 2.5.8) passes on any page with a link, because a 0×0 target is measured against
nothing.

eaa-kit never passes those on. Rules the engine cannot decide are reported as
**not evaluated**, with the reason, whatever axe-core said about them:

```
Not evaluated
  This engine reached no verdict on these.
  They are never reported as passing.
  · color-contrast 4 pages, WCAG 1.4.3
      needs rendered foreground and background colours
  · target-size 4 pages, WCAG 2.5.8
      needs element geometry; every box is 0x0 without layout
```

Two further consequences worth knowing:

- **Client-rendered pages are mostly invisible to it.** A page whose content is assembled
  by JavaScript at runtime has little in its built HTML to audit, and the report will show
  a small number of passed rules to match.
- **Content inside iframes is not audited**, since nothing is fetched.

A `--browser` mode using Playwright as an optional peer dependency is planned for the
rules that need a real rendering engine.

## The four result categories

axe-core returns four outcomes per rule, and eaa-kit keeps them separate everywhere,
including in the JSON document. They are not interchangeable:

| Category | Meaning |
| --- | --- |
| `violations` | The rule matched elements and failed |
| `incomplete` | No verdict: either a human has to decide (`needs-review`) or this engine is blind to it (`engine-limitation`) |
| `passes` | The rule matched elements and was met. **The only category that is evidence of anything** |
| `inapplicable` | The rule found nothing to check. Not a pass, and never evidence of compliance |

A page with no images is not compliant with image-alternative requirements; it simply has
nothing to prove. Adding `passes` and `inapplicable` together would score an empty page
near-perfect, which is why eaa-kit never presents a single "rules checked" number.

Every rule axe-core actually runs lands in exactly one of the four, so nothing silently
disappears from a report.

## JSON report format

`--format json` emits a versioned document. **This is a public contract.**

### Compatibility

- `schemaVersion` is an integer, currently `1`.
- It is bumped only when a field is **removed, renamed, or changes meaning**.
- New fields may be added without a bump, so **consumers must ignore fields they do not
  recognise**.
- Rule ids, WCAG success criteria and EN 301 549 clauses come from axe-core and may change
  when its major version changes; `tool.axeCore` records which version produced the report.

Deliberately **not** in the document, and not coming later: absolute filesystem paths
(they leak the build machine into anything you commit), per-page timings (they would make
two reports of the same build differ), and raw axe-core tags (promising those would tie
this schema to axe-core's).

Output is deterministic for a given run apart from `generatedAt`: pages are sorted by
path, findings by rule id, and the rule index by key, so two reports diff cleanly.

### Shape

```jsonc
{
  "schemaVersion": 1,
  "tool": {
    "name": "eaa-kit",
    "version": "0.0.0",
    "axeCore": "4.13.0"
  },
  "generatedAt": "2026-08-20T18:00:00.000Z",   // ISO 8601, UTC
  "engine": "jsdom",                            // "jsdom" | "browser"
  "target": {
    "directory": "./dist",
    "baseUrl": null                             // string when --base-url was used
  },
  "summary": {
    "pages": 5,
    "pagesWithViolations": 1,
    "pagesNotAudited": 0,
    "violations": 3,                            // counted once per rule per page
    "violatingElements": 3,
    "byImpact": {
      "critical": 1, "serious": 2, "moderate": 0, "minor": 0,
      "unclassified": 0                         // axe-core gave no impact
    },
    "needsReview": 1,
    "notEvaluated": 21,
    "passes": 21,                               // summed over pages; not a score
    "inapplicable": 269,                        // summed over pages; never evidence
    "failOn": "serious",
    "failing": 3                                // non-zero means the CLI exits 1
  },

  // Rule metadata is held once here and referenced by id everywhere else.
  // Sorted by rule id.
  "rules": {
    "image-alt": {
      "help": "Images must have alternative text",
      "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/image-alt?application=axeAPI",
      "successCriteria": ["1.1.1"],             // WCAG
      "en301549": ["9.1.1.1"]                   // EN 301 549 clauses
    }
  },

  "pages": [
    {
      "path": "index.html",                     // relative to target.directory, POSIX
      "url": "file:///…/index.html",
      "violations": [
        {
          "ruleId": "image-alt",                // key into "rules"
          "impact": "critical",                 // minor|moderate|serious|critical|null
          "nodes": [
            {
              "html": "<img src=\"/logo.svg\">",
              "target": ["img"],                // CSS selector path
              "failureSummary": "Fix any of the following: …"   // or null
            }
          ]
        }
      ],
      "incomplete": [
        {
          "ruleId": "color-contrast",
          "impact": "serious",
          "nodes": [],
          "reason": "engine-limitation",        // "needs-review" | "engine-limitation"
          "reasonDetail": "needs rendered foreground and background colours"
        }
      ],
      "passes": ["document-title", "html-has-lang"],      // rule ids
      "inapplicable": ["area-alt", "blink", "label"],     // rule ids
      "error": null                             // string when the page could not be audited
    }
  ]
}
```

When `error` is non-null, all four category arrays on that page are empty.

## SARIF output

`--format sarif` emits a SARIF 2.1.0 log for GitHub code scanning. See
[GitHub Actions](#github-actions) for wiring it up.

Real results from the audit shown above, abbreviated:

```jsonc
{
  "version": "2.1.0",
  "runs": [
    {
      "tool": { "driver": { "name": "eaa-kit", "version": "0.0.0", "rules": [ /* 63 rules */ ] } },
      "results": [
        {
          "ruleId": "frame-title",
          "ruleIndex": 33,
          "level": "error",
          "kind": "fail",
          "message": { "text": "Frames must have an accessible name. Element: iframe" },
          "locations": [
            { "physicalLocation": { "artifactLocation": { "uri": "index.html" } } }
          ],
          "partialFingerprints": { "eaaKit/v1": "d2662067eee40735" }
        },
        {
          "ruleId": "link-name",
          "ruleIndex": 43,
          "level": "error",
          "kind": "fail",
          "message": { "text": "Links must have discernible text. Element: .social-link" },
          "locations": [
            { "physicalLocation": { "artifactLocation": { "uri": "index.html" } } }
          ],
          "partialFingerprints": { "eaaKit/v1": "47b14044a8b899a8" }
        }
      ],
      "invocations": [{ "executionSuccessful": true, "toolExecutionNotifications": [] }],
      "properties": { "engine": "jsdom", "pages": 1, "needsReview": 1, "notEvaluated": 5 }
    }
  ]
}
```

- Every rule the run touched becomes an entry in `tool.driver.rules`, with its help text,
  help URL, and the WCAG and EN 301 549 references in `properties.tags`.
- Each violating **element** becomes one result, with the page as the artifact location and
  the CSS selector in the message: `Images must have alternative text. Element: img`.
- Impact maps to level: `critical` and `serious` → `error`, `moderate` → `warning`,
  `minor` → `note`. A violation axe-core left unclassified becomes `error`, on the same
  reasoning as `--fail-on`.
- Results carry a `partialFingerprints` entry derived from the rule, selector and element
  markup, deliberately not the file path, so moving a page does not close one alert and
  open an identical one.

Three things worth knowing before you wire it up:

1. **Artifact URIs are relative to the working directory** (for example
   `dist/index.html`). If your build output is gitignored, GitHub will show the alerts but
   cannot link them to source. Auditing a directory outside the repository falls back to
   the page path alone.
2. **No line numbers.** axe-core reports a CSS selector, not a source position, so results
   locate the file rather than a line within it. Alerts appear at file level.
3. **Only violations become results.** Rules needing manual review, and rules this engine
   could not evaluate, are not defects at a source location, and filing them as alerts
   would bury the real failures. They are counted in `runs[0].properties` so a log with no
   results is not mistaken for "everything was checked" — and the JSON format carries them
   in full. **A green code-scanning result is not a compliance statement.**

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
      - uses: OWNER/eaa-kit@v1        # replace OWNER with this repository's owner
        with:
          install-command: npm ci
          build-command: npm run build
          directory: ./dist
          fail-on: serious
```

A runnable copy lives in [.github/workflows/accessibility.yml](.github/workflows/accessibility.yml).

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

## License

MIT
