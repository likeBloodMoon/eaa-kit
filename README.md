# eaa-kit

[![CI](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/likeBloodMoon/eaa-kit/actions/workflows/ci.yml)

Build-time WCAG 2.2 AA auditor for static sites, aimed at freelancers and small agencies in
the DACH region who have to comply with the European Accessibility Act (in force since
28 June 2025), the BFSG in Germany and the BaFG in Austria.

```bash
npx eaa-kit audit ./dist
```

```bash
npx eaa-kit statement             # Barrierefreiheitserklärung from eaa.config
```

> **Not legal advice.** eaa-kit reports what an automated engine can and cannot determine
> about your markup. Automated testing catches a minority of accessibility barriers; it is
> a floor, not a certificate.

## Install

```bash
pnpm add -D eaa-kit    # npm i -D eaa-kit
```

Node 22.22 or newer. jsdom, which the browserless engine is built on, does not
support Node 20.

## audit

```bash
eaa-kit audit [dir]              # dir defaults to ./dist
```

Output from the test fixtures in this repository, which carry known violations:

```
eaa-kit audit 5 pages · jsdom (browserless)
passed = checked and met · not applicable = nothing to check

about/index.html
  ✓ no violations
    6 passed · 53 not applicable · 4 not evaluated

blog/post-1.html
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

drafts/draft.html
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

index.html
  ✗ image-alt critical, WCAG 1.1.1
      Images must have alternative text
      img
        <img src="/assets/logo.svg">
  ✗ html-has-lang serious, WCAG 3.1.1
      <html> element must have a lang attribute
      html
        <html><head> <title>Startseite</title> </head> <body> <img src="/assets…
  ✗ link-name serious, WCAG 2.4.4 4.1.2
      Links must have discernible text
      a
        <a href="/about/"></a>
  ? bypass needs manual review, WCAG 2.4.1
    3 passed · 51 not applicable · 1 to review · 5 not evaluated

legacy.htm
  ✓ no violations
    4 passed · 55 not applicable · 4 not evaluated

Summary
  3 violations on 1 of 5 pages (3 elements)
  3 at or above serious (--fail-on serious)
  1 rule needs manual review

Not evaluated
  This engine reached no verdict on these.
  They are never reported as passing.
  · color-contrast 5 pages, WCAG 1.4.3
      needs rendered foreground and background colours
  · link-in-text-block 5 pages, WCAG 1.4.1
      needs rendered colours and text decoration
  · no-autoplay-audio 5 pages, WCAG 1.4.2
      needs media duration, and media is never loaded
  · scrollable-region-focusable 5 pages, WCAG 2.1.1 2.1.3
      needs computed overflow
  · target-size 1 page, WCAG 2.5.8
      needs element geometry; every box is 0x0 without layout
```

That run exits 1.

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
| `--browser` | off | Audit in real Chromium instead of jsdom |
| `--concurrency <n>` | from page and core count | Worker threads to audit with; `1` audits in one thread |

Dot directories such as build caches are skipped by default. `--include` and `--exclude`
replace the defaults rather than adding to them.

#### `--fail-on <impact>`

`minor`, `moderate`, `serious` (default) or `critical`. Any violation at or above the
level fails the run.

Violations below the threshold are still reported; they just do not fail the build, and
the summary says why rather than leaving you to guess:

```
Summary
  1 violation on 1 of 1 page (1 element)
  none at or above serious (--fail-on serious), so this run passes
```

Raising the threshold on the run shown above narrows what counts:

```
Summary
  3 violations on 1 of 5 pages (3 elements)
  1 at or above critical (--fail-on critical)
  1 rule needs manual review
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

#### `--concurrency <n>`

The browserless engine audits pages across worker threads. Roughly 80% of a page's audit
time is spent inside axe-core with the CPU pinned, so this is the one place where more
cores actually buy something. On a 4-core machine, over 100 pages of a typical marketing
site:

| Threads | Total | Per page |
| --- | --- | --- |
| `--concurrency 1` | 19.9 s | 199 ms |
| 3 (the default here) | 10.0 s | 100 ms |

How many threads are used is decided from how much work the run looks like, not from the
page count: five pages of a real site are worth threading and forty pages of stubs are
not, and what separates them is how much markup there is to walk. Below roughly half a
second of estimated work the run stays on one thread, where a worker would spend longer
loading jsdom than it saves; above it, one worker per ~1.6 s of work, capped at eight and
at one fewer than the core count. A two-core machine never threads. `--concurrency <n>`
overrides all of it, and `--concurrency 1` is the single-threaded path.

Threads change how long the audit takes and nothing else. Pages are reported in the order
they were collected rather than the order they finished, so two runs of the same build
produce byte-identical reports — a test asserts that the threaded and single-threaded
runs agree page for page.

The Chromium engine is unaffected: `--browser` drives one browser context sequentially,
where the bottleneck is the browser rather than this process.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No violations at or above `--fail-on` |
| `1` | At least one violation at or above `--fail-on` |
| `2` | The audit could not run or could not finish: missing build directory, no HTML found, a page that could not be audited, or a usage error such as an unknown flag |

A page that could not be audited exits `2` rather than `0`. It is neither clean nor
failing, and reporting a pass for markup nothing read would be worse than reporting a
broken run.

## statement

Generates an accessibility statement (Barrierefreiheitserklärung) from a config file and,
optionally, from an audit report — in German or English, as Markdown or HTML, with the
statute and supervisory body of the country you name.

```bash
eaa-kit statement                                   # to stdout
eaa-kit statement --output src/content/a11y.md      # to a file
eaa-kit statement --lang en --country DE            # override both
eaa-kit statement --output public/a11y.html         # a standalone HTML page
eaa-kit statement --audit a11y.json                 # list what the audit found
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--config <path>` | searched for | Path to the config file |
| `--lang <locale>` | from `site.locale` | `de` or `en` |
| `--country <code>` | from `enforcement.country` | `AT` or `DE` |
| `--audit <path>` | — | A report from `eaa-kit audit --format json`; its violations are listed as non-accessible content |
| `--format <format>` | from `--output` | `markdown` or `html` |
| `--output <path>` | stdout | Write to a file; parent directories are created |

Exit codes are `0` when the statement was produced and `2` when it could not be: no
config, an invalid one, a country whose template does not exist yet, or an audit report
that could not be read.

Every statement carries the five sections the EU model requires: conformance status,
non-accessible content with a reason for each barrier, how to send feedback, the
enforcement procedure, and when the statement was prepared.

### Markdown or HTML

`--format` decides what is produced and `--output` where it goes. With no `--format`, an
`--output` path ending in `.html` or `.htm` produces HTML and anything else produces
Markdown, so `--output public/a11y.html` needs no second flag.

The HTML is one self-contained page: a `<title>`, `lang` on the root element, `<main>`,
real headings and lists, and a small `<style>` block that follows the reader's light or
dark preference. It has no external assets and no scripts, which is what makes it
publishable by copying one file. The markup inside `<main>` carries no classes, so pasting
that part into your own layout and dropping the `<style>` block works too. The page is
audited by the test suite with eaa-kit's own engine, on the principle that a statement
generator emitting an inaccessible statement has failed at the one job it has.

### The config file

`eaa.config.ts`, `.mts`, `.js`, `.mjs` or `.json`, found by walking up from the working
directory. TypeScript configs are read directly — Node strips the types, so there is no
build step and no loader dependency.

```ts
import { defineConfig } from 'eaa-kit'

export default defineConfig({
  site: {
    name: 'Musterbetrieb',
    url: 'https://example.at',
    locale: 'de-AT',              // decides the statement language unless --lang is given
  },
  provider: {
    legalName: 'Musterbetrieb GmbH',
    email: 'office@example.at',   // required: the feedback address the EAA obliges you to offer
    phone: '+43 1 2345678',       // optional
    address: 'Hauptstraße 1, 1010 Wien',  // optional
    feedbackUrl: 'https://example.at/kontakt',  // optional: a contact or feedback form
  },
  compliance: {
    status: 'partially-compliant',        // 'compliant' | 'partially-compliant' | 'non-compliant'
    standard: 'EN 301 549 V3.2.1 (WCAG 2.2 AA)',   // optional, this is the default
    assessedOn: '2026-08-21',             // ISO date, validated
    assessmentMethod: 'self-assessment',  // or 'external-audit'
    auditReason: 'fix-planned',           // reason given to barriers from --audit
    knownIssues: [
      {
        description: 'Die eingebettete Karte hat keinen Titel.',
        successCriteria: ['4.1.2'],       // WCAG
        en301549: ['9.4.1.2'],            // EN 301 549 clauses
        reason: 'fix-planned',            // or 'disproportionate-burden' | 'out-of-scope'
        remedyBy: '2026-12-31',
      },
      'Ältere PDF-Dokumente sind nicht barrierefrei.',   // shorthand for { description }
    ],
  },
  enforcement: {
    country: 'AT',   // AT and DE today; CH is not written yet
  },
})
```

A complete example config is at [examples/eaa.config.json](examples/eaa.config.json), and
the statements it produces are at [examples/statement.de.md](examples/statement.de.md),
[examples/statement.en.md](examples/statement.en.md) and
[examples/statement.de.html](examples/statement.de.html).

### What it produces

```markdown
# Erklärung zur Barrierefreiheit

Musterbetrieb GmbH ist bemüht, die Website Musterbetrieb im Einklang mit dem
österreichischen Barrierefreiheitsgesetz (BaFG) barrierefrei zugänglich zu machen. Das
BaFG setzt die Richtlinie (EU) 2019/882 (European Accessibility Act) in österreichisches
Recht um.

…

## Nicht barrierefreie Inhalte

- Die eingebettete Karte hat keinen Titel.
  Betroffene Anforderung: WCAG 4.1.2, EN 301 549 9.4.1.2
  Grund: die Barriere ist bekannt und wird behoben.
  Geplante Behebung bis: 31. Dezember 2026
- Ältere PDF-Dokumente sind nicht barrierefrei.

## Beschwerdeverfahren

Wenn Sie mit unserer Antwort nicht zufrieden sind, können Sie sich an das
Sozialministeriumservice wenden. …
```

The `AT` template names the Barrierefreiheitsgesetz and the Sozialministeriumservice; the
`DE` template names the Barrierefreiheitsstärkungsgesetz and the Marktüberwachungsstelle
der Länder (MLBF). Both transpose Directive (EU) 2019/882.

### Barriers from an audit run

```bash
eaa-kit audit ./dist --format json --output a11y.json
eaa-kit statement --audit a11y.json --output src/content/a11y.md
```

Each rule the audit found failing becomes one entry under non-accessible content, folded
across every page it failed on, and the entries the config describes stay first:

```markdown
- Ältere PDF-Dokumente sind nicht barrierefrei.
- Images must have alternative text
  Betroffene Anforderung: WCAG 1.1.1, EN 301 549 9.1.1.1
  Betroffene Seiten: index.html
  Grund: die Barriere ist bekannt und wird behoben.
  Automatisiert erkannt (axe-core, Regel image-alt); bitte in eigenen Worten beschreiben.
```

**Those descriptions are axe-core's, and axe-core speaks English.** Generating German
legal prose out of an English rule description behind your back would be worse than
showing you where it came from, so each entry says so and asks to be rewritten — in the
statement's language, in your own words, about your own site. The wording is in the
document rather than only in a warning on stderr, because the person who publishes the
statement is not always the person who ran the command.

Four more things this does deliberately:

- **Only violations become barriers.** A rule that needs manual review has not been found
  inaccessible, and a rule this engine could not evaluate has not been found anything at
  all. Both are reported as counts in the "preparation" section instead, so a reader can
  see how much the automated run left open rather than mistaking the list for the whole
  picture.
- **The reason is a setting, not a guess.** An audit report carries no reason for a
  barrier existing, so every derived entry gets `compliance.auditReason`, which defaults
  to `fix-planned`. Disproportionate burden and out-of-scope are claims only you can make.
- **Affected pages are listed, up to five**, and counted after that, so a site-wide
  barrier does not turn the statement into a sitemap.
- **Barriers are ordered worst first**, with an unclassified impact leading, on the same
  reasoning as `--fail-on`: not knowing how bad a barrier is is not evidence that it is
  mild.

The statement never repeats the audit's verdict on your behalf either: `--audit` does not
touch `compliance.status`. Declaring the site partially or fully conformant stays a
decision you make in the config.

### Read it before you publish it

**The generated statement is a draft, not legal advice, and it says so in its own last
paragraph.** It states what you told it: the status you declared and the barriers you
listed. eaa-kit cannot check whether those claims are true, and a statement claiming full
conformance for a site that is not conformant is worse than no statement at all.

That applies twice over to barriers taken from `--audit`: they arrive as English rule
descriptions with a line asking you to rewrite them, and publishing them as they stand
means publishing a German legal document containing English tool output — and a to-do
note addressed to yourself.

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

`--browser` closes that gap; see below.

## Browser mode

```bash
pnpm add -D playwright          # optional peer dependency
npx playwright install chromium # the browser binary is separate
eaa-kit audit ./dist --browser
```

Same audit, same report shape, in real Chromium. The difference is what it can decide.
On a page whose only defect is `#cccccc` text on white:

```
# jsdom
  ✓ no violations
    6 passed · 52 not applicable · 5 not evaluated

# --browser
  ✗ color-contrast serious, WCAG 1.4.3
    8 passed · 55 not applicable
```

Nothing is reported as unevaluated in browser mode, because with layout and CSS there is
no reason to. Both engines cover the same rule set, so the two reports compare directly.

Three things it does differently, all deliberate:

1. **The build is served over loopback**, not opened as `file://` URLs. Root-absolute asset
   paths — `/assets/site.css`, which every static site generator emits — do not resolve
   under `file://`. Measured on a page whose stylesheet sets `color: #ccc`: the computed
   colour is the default black over `file://` and the real value over `http://`. Auditing
   contrast against an unstyled page would be worse than not auditing it.
2. **Your JavaScript runs.** Client-rendered content is audited as a visitor sees it, which
   is the other half of what the browserless engine cannot reach.
3. **Content-Security-Policy is bypassed** for the audited page, or a site that sets one
   would refuse the injected axe-core and every page would come back unaudited.

Playwright stays an optional peer dependency: the default path never downloads a browser,
and `--browser` without it exits 2 with the two commands above rather than a stack trace.
Pages are rendered at 1280×720, which is what `target-size` and anything else
layout-dependent is measured against.

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

A complete generated document is checked in at
[examples/report.json](examples/report.json), with the SARIF equivalent at
[examples/report.sarif](examples/report.sarif).

### Shape

```jsonc
{
  "schemaVersion": 1,
  "tool": {
    "name": "eaa-kit",
    "version": "0.1.0",
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

Real results from the fixture run above, abbreviated:

```jsonc
{
  "version": "2.1.0",
  "runs": [
    {
      "tool": { "driver": { "name": "eaa-kit", "version": "0.1.0", "rules": [ /* 63 rules */ ] } },
      "results": [
        {
          "ruleId": "html-has-lang",
          "ruleIndex": 35,
          "level": "error",
          "kind": "fail",
          "message": { "text": "<html> element must have a lang attribute. Element: html" },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "tests/fixtures/site/index.html" }
              }
            }
          ],
          "partialFingerprints": { "eaaKit/v1": "4c2a13ab4c8c0365" }
        },
        {
          "ruleId": "image-alt",
          "ruleIndex": 38,
          "level": "error",
          "kind": "fail",
          "message": { "text": "Images must have alternative text. Element: img" },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": { "uri": "tests/fixtures/site/index.html" }
              }
            }
          ],
          "partialFingerprints": { "eaaKit/v1": "f0e17d2582e9a5b3" }
        }
      ],
      "invocations": [{ "executionSuccessful": true, "toolExecutionNotifications": [] }],
      "properties": {
        "engine": "jsdom",
        "pages": 5,
        "needsReview": 1,
        "notEvaluated": 21,
        "notEvaluatedRules": ["color-contrast", "link-in-text-block", "no-autoplay-audio",
                              "scrollable-region-focusable", "target-size"]
      }
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
      - uses: likeBloodMoon/eaa-kit@v1
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
