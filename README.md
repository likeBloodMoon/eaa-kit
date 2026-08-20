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

| Flag | Meaning |
| --- | --- |
| `--include <globs...>` | Glob patterns to audit, relative to `dir` |
| `--exclude <globs...>` | Glob patterns to skip |
| `--base-url <url>` | Audit pages under their real site URL instead of `file://` |
| `--fail-on <impact>` | Lowest impact that fails the run: `minor`, `moderate`, `serious` (default), `critical` |
| `--format <format>` | `console` (default) or `json` |
| `--output <path>` | Write the report to a file instead of stdout; parent directories are created |

The console report goes to stdout and progress goes to stderr, so the report can be piped
without the chatter coming along.

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

### Using it in CI

```bash
eaa-kit audit ./dist --format json --output reports/a11y.json --fail-on serious
```

The exit code reflects `--fail-on` regardless of format, so the same command both fails
the build and leaves an artefact behind.

## License

MIT
