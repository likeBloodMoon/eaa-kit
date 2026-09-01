# Report formats

`--format` selects what the audit produces. `console` is the default and is documented
with [the audit command](audit.md); the three below are the machine-readable and
shareable ones.

## JSON report format

`--format json` emits a versioned document. **This is a public contract.**

### Compatibility

- `schemaVersion` is an integer, currently `2`.
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
[examples/report.json](../examples/report.json), with the SARIF equivalent at
[examples/report.sarif](../examples/report.sarif).

### Shape

```jsonc
{
  "schemaVersion": 2,
  "tool": {
    "name": "eaa-kit",
    "version": "0.1.0",
    "axeCore": "4.13.0"
  },
  "generatedAt": "2026-08-20T18:00:00.000Z",   // ISO 8601, UTC
  "engine": "jsdom",                            // "jsdom" | "browser"
  "target": {
    "source": "./dist",                         // what was audited; read this one
    "kind": "directory",                        // "directory" | "url"
    "directory": "./dist",                      // null when kind is "url"
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
    "failing": 3,                               // non-zero means the CLI exits 1
    "accepted": 0                               // violating elements a --baseline accepted
  },

  // What the run measured, and what it never reached. "summary" counts the
  // pages that were audited; this says whether those were all the pages there
  // are. Read "complete" before drawing any conclusion from the counts above.
  "completeness": {
    "complete": true,                           // false when anything went unmeasured
    "discovery": "directory",                   // "directory" | "sitemap" | "links"
    "collected": 5,                             // pages handed to the engine
    "audited": 5,                               // pages that reached a verdict
    "errored": 0,                               // collected, then could not be audited
    "truncated": false,                         // stopped at --max-pages
    "unreachable": [                            // known pages never collected
      // { "location": "https://example.com/pricing", "reason": "HTTP 404" }
    ]
  },

  // How much of WCAG this run could reach. The four counts partition the 55
  // WCAG 2.2 A/AA criteria exactly once and must NEVER be summed into a ratio.
  "coverage": {
    "total": 55,                                // WCAG 2.2 criteria at A and AA
    "evaluated": 6,                             // a rule reached a verdict here
    "notEvaluated": 5,                          // a rule exists; this engine is blind
    "nothingToCheck": 10,                       // rules ran, nothing on the site matched
    "noAutomatedRule": 34,                      // nothing can check it; a person must
    "browserWouldAnswer": 4,                    // of notEvaluated, how many --browser answers
    "criteria": [
      {
        "number": "1.1.1",
        "title": "Non-text Content",
        "level": "A",                           // "A" | "AA"
        "status": "evaluated",                  // evaluated | not-evaluated
                                                // | nothing-to-check | no-automated-rule
        "rules": ["image-alt"],                 // keys into "rules"
        "browserWouldAnswer": false
      }
    ]
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
      "path": "index.html",                     // relative to target.source, POSIX
      "url": "file:///…/index.html",
      "violations": [
        {
          "ruleId": "image-alt",                // key into "rules"
          "impact": "critical",                 // minor|moderate|serious|critical|null
          "nodes": [
            {
              "html": "<img src=\"/logo.svg\">",
              "target": ["img"],                // CSS selector path
              "failureSummary": "Fix any of the following: …",  // or null
              "fingerprint": "9f2a1c4e8b7d0356"   // stable identity of this element
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
      // Present only when --baseline was used. Still violations; never counted
      // in "violations" or in summary.failing.
      "accepted": [],
      "passes": ["document-title", "html-has-lang"],      // rule ids
      "inapplicable": ["area-alt", "blink", "label"],     // rule ids
      "error": null                             // string when the page could not be audited
    }
  ]
}
```

When `error` is non-null, all four category arrays on that page are empty.

### `target.source` and `target.directory`

`source` is what the run audited: a build directory, or the URL a crawl started from.
`kind` says which. `directory` holds a directory or `null` — never a URL.

That split exists so `schemaVersion` can stay honest. `directory` was the only field here
in version 1 and was documented as the build directory; letting it quietly start holding a
URL would break the consumers the version number exists to protect. Crawls did not exist
under version 1, so no report shape that version could already produce has changed, and
the version has not moved.

Read `source` in new code. `directory` is kept for consumers written against version 1.

### `completeness`

Every other number in the document describes the pages that were audited. None of them
describes the pages that were not, and that is the one thing a consumer cannot work out
for itself: a crawl that fetched twelve pages of a two-hundred-page site and a complete
run over twelve pages produce identical summaries.

So `completeness` carries what the collection stage knew. `complete` is true only when
nothing was left unmeasured — no page unreachable, none errored, and the run did not stop
at its limit. A tool deciding whether a clean report means anything should read it first.

`errored` and `unreachable` are counted apart on purpose. An unreachable page was never
fetched; an errored one was fetched and then could not be audited. They are different
failures with different fixes, and summing them would name neither.

`completeness` was added without moving `schemaVersion`: new fields may
appear without a bump, and consumers must ignore what they do not recognise. A consumer
written against an earlier version that has never seen this field should treat its absence
as unknown rather than as a complete run.

### `fingerprint`

Each node carries the same identity the baseline file records and SARIF sends as a partial
fingerprint: a hash of the rule, the selector and the element's own opening tag, and
deliberately not of the page it was found on. Two consumers already depended on it
agreeing — SARIF, so that moving a page does not close one code-scanning alert and open an
identical one, and the baseline, so an accepted violation stays accepted when the
surrounding page changes.

The tag, not the element's whole markup. axe-core reports the failing element's outerHTML,
which for `<html>` — the element every document-level rule fails against — is the entire
page. Hashing that made `html-has-lang` and `document-title` change identity on any edit
to the page they were on, which is precisely what these two consumers exist to survive.
Where two elements share an opening tag, axe-core's selector already tells them apart.

It is emitted so a third does not have to reimplement the hash and risk disagreeing with
them. `eaa-kit diff` matches on it.

### `coverage`

The denominator is the standard, not your markup. WCAG 2.2 has 55 success criteria at
Levels A and AA; axe-core has rules touching 23 of them, and the rest cannot be checked by
any automated engine at all.

Do not divide these. `noAutomatedRule` is the majority of WCAG, so any ratio built from
these counts would present a limit of automated testing as though it were a measurement of
the site — which is the same mistake as adding `inapplicable` to `passes`, and the reason
`nothingToCheck` is a bucket of its own rather than part of `evaluated`.

`browserWouldAnswer` is the cost of the browserless engine as a number: how many of the
`notEvaluated` criteria a `--browser` run would decide. The remainder need a person
whatever engine runs.

Added without moving `schemaVersion`.

## Comparing two runs

```bash
eaa-kit diff before.json after.json
```

Neither report answers the question a review asks. Running the auditor on a branch prints
everything wrong with the site; almost all of it was already there, and the two or three
findings somebody introduced are somewhere in the middle of it.

`diff` reads two JSON reports and sorts every violating element into four:

| | |
| --- | --- |
| **new** | In the later run and not the earlier one |
| **fixed** | In the earlier run, gone from the later one, on a page the later run audited |
| **unchanged** | In both |
| **not compared** | In the earlier run, on a page the later run never audited |

That last one is the reason to trust the other three. A violation missing from the second
run has two possible explanations — somebody fixed it, or nothing looked at that page — and
they are not interchangeable. Reporting the second as *fixed* would turn a crawl that
stopped early into a changelog of work nobody did. So a violation is called fixed only when
the later run actually reached a verdict on the page it was on, and the rest are listed
apart, with the pages named.

Markup that changed counts as a different violation rather than the same one, which is the
conservative reading: it avoids calling something fixed because its surroundings moved.

`--fail-on` judges **new** violations only. A diff that failed on what was already there
would be an audit with extra steps, and would go red on every branch of a site carrying any
debt.

| Code | Meaning |
| --- | --- |
| `0` | No new violations at or above `--fail-on` |
| `1` | At least one |
| `2` | A report could not be read |

This is not a [baseline](baseline.md), and does not replace one. A baseline is a file
somebody commits and maintains, and it answers *what have we agreed to live with*. A diff
is stateless, needs no decision from anybody, and answers *what did this change do*.

## SARIF output

`--format sarif` emits a SARIF 2.1.0 log for GitHub code scanning. See
[GitHub Actions](integrations.md#github-actions) for wiring it up.

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
          "partialFingerprints": { "eaaKit/v2": "b6128eff391a4be6" }
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
          "partialFingerprints": { "eaaKit/v2": "f0e17d2582e9a5b3" }
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

## HTML report

`--format html` writes a single self-contained page. The console report is for whoever ran
the command and JSON and SARIF are for other programs; this one is for somebody who was
not at the terminal — the client whose site it is, or whoever has to fix it.

```bash
eaa-kit audit ./dist --format html --output a11y.html
```

A complete generated report is at [examples/report.html](../examples/report.html). It opens
with the verdict and a scoreboard, then **What to fix** — the violations grouped by the
element that causes them — then what the run was, the summary, a section per page, and the
rules the engine could not evaluate.

- **It leads with the work, not the inventory.** On a site built from components one broken
  header is one line in one file; a page-by-page listing reports it as many findings
  without ever saying they are the same defect. Each entry names the markup, how many
  pages carry it, and — where a router convention names one — the source file. Identical
  markup on three or more pages is called out as likely one shared component.
- **The scoreboard carries what was *not* evaluated beside the severity counts**, at the
  same size. That placement is deliberate: a row reading "0 critical, 0 serious" is the one
  place this document could overstate, because the same run may have left whole rule
  categories unchecked, and a reader who stops at the top would take it for a clean site.

- **One file, no assets, no scripts.** It can be attached to an email and opened. Nothing
  in it fetches anything, which also means it cannot phone home from a client's machine.
- **The element markup is escaped.** This is the one document eaa-kit produces that quotes
  arbitrary HTML from somebody's build, and a page that fails an audit for carrying a
  stray `<script>` must not hand that script to whoever opens the report.
- **It follows the reader's light or dark preference**, and prints on white.
- **It says the same things the console report says**, in the same order and with the same
  refusals: the four result categories stay apart, unevaluated rules are named rather than
  dropped, and the footer says in as many words that a report with no findings is not a
  compliance statement.
- **The output is deterministic** apart from the timestamp, so two reports of the same
  build diff cleanly.

The report is audited by eaa-kit's own engine in the test suite, and every colour pair in
it is checked against WCAG AA — the worst is 6.3:1 against a 4.5:1 requirement. A tool
that emitted an inaccessible accessibility report would have failed at the one job it has.
