# Recording a manual review

Of the 55 WCAG 2.2 success criteria at Levels A and AA, **34 have no automated rule at
all**. Every eaa-kit report has said so since 0.3, and saying so was where it stopped:
there was nowhere to put the answer, so a site nobody had ever reviewed and a site audited
by hand last week produced identical coverage.

`eaa-kit checklist` writes the review down, and `eaa-kit audit --review` reads it back.

```bash
eaa-kit checklist --output a11y-review.md   # the worksheet, and the record beside it
# work through it, filling in eaa-review.json
eaa-kit audit --review eaa-review.json --coverage
```

## The two files

`eaa-kit checklist` writes both from one list of criteria, so they cannot disagree about
what the review covers.

| | |
| --- | --- |
| **`eaa-review.json`** | The record. The file the tool reads back, and the one you edit. |
| **The worksheet** | Markdown, to `--output` or stdout. Generated, and never read back. |

The worksheet is the document you work through: every criterion, what it requires, the
rules that touch it, and the check to do by hand where this engine names one. Ticking a box
in it records nothing — the answers go in the JSON, which is what `--review` reads.

| Flag | |
| --- | --- |
| `--record <path>` | Where the answers live (default: `eaa-review.json`) |
| `--output <path>` | Write the worksheet here instead of stdout |
| `--reviewed-by <name>` | Who is carrying out the review |

Re-running is safe, and is the point: every answer already in the record is kept and only
the missing entries are filled in, so a review done over three sittings survives a
criterion list that grew between them. A record that exists and cannot be parsed stops the
command with exit 2 rather than being replaced — it holds work no tool can redo.

## Filling it in

```jsonc
{
  "schemaVersion": 1,
  "reviewedBy": "Alex Reviewer",
  "criteria": {
    "1.2.3": {
      "result": "met",
      "reviewedOn": "2026-09-01",
      "note": "No prerecorded video anywhere on the site."
    },
    "1.3.2": {
      "result": "not-met",
      "reviewedOn": "2026-09-01",
      "note": "The sidebar reads before the article on mobile."
    },
    "1.4.4": { "result": "unreviewed" }
  }
}
```

| `result` | |
| --- | --- |
| `met` | You checked it and the site meets it |
| `not-met` | You checked it and it does not. Say what is wrong in `note` |
| `not-applicable` | Nothing on this site the criterion applies to |
| `unreviewed` | Nobody has looked yet. What every entry starts as |

`not-applicable` is kept apart from `met` for the same reason `inapplicable` is kept apart
from `passes` everywhere else in this tool: a criterion with nothing to apply to has not
been met, it has been ruled out, and adding the two together would let an empty site look
conformant.

`reviewedOn` is the day you checked it, and it matters — see the maximum age below.

## What a review does not do

A review is a claim by a person. The tool records it, reports it, and cannot check that any
of it is true — the same standing as the claims in the statement it generates. So it is
kept beside what the run measured and never folded into it:

- **It never overrules the engine.** A criterion the run reached a verdict on keeps that
  verdict. Recording `met` against a rule that is currently failing changes nothing but
  what is printed beside it, and the entry is shown as not counted, with the reason.
- **It never moves the four coverage counts.** `evaluated`, `this engine could not evaluate
  it`, `rules ran and found nothing to check` and `no automated rule exists` still partition
  the 55 criteria by what the engine reached. What a person recorded is counted separately
  and is never added to them, or divided into anything.
- **It never counts `unreviewed`.** Generating the worksheet is not doing the review.
- **It never counts an entry that has aged out**, under `--review-max-age`.

## Reading it back

```bash
eaa-kit audit --review eaa-review.json                    # every dated entry stands
eaa-kit audit --review eaa-review.json --review-max-age 365
```

```
Of the 55 WCAG 2.2 A and AA success criteria, 34 cannot be checked by any
automated engine and need a person. This run reached a verdict on 6.
A person recorded a result for 12 of the criteria this run did not reach; 2 of
them as not met; 3 further entries were not counted. This is a claim by a
person, not a measurement.
```

`--coverage` puts each recorded result under its criterion, and the HTML report always
does. An entry that was not counted still appears, with which of the three refusals applied:

| | |
| --- | --- |
| `this run reached its own verdict here` | The engine decided the criterion itself |
| `older than --review-max-age` | The check is older than the run was willing to accept |
| `no date recorded` | Undated, and a maximum age was asked for |

**`--review-max-age <days>` is off unless you ask for it.** How long a manual review stays
true is a judgement about how fast a site changes, and the tool has no way to make it. Ask
for one, and an undated entry stops counting too: an undated review cannot be shown to
still hold, which is precisely the question the flag asks.

Both keys can be written down once in [`eaa.config`](audit.md#defaults-from-eaaconfig), as
`review` and `reviewMaxAge`, and both reach the places most runs of this tool actually
happen: the [GitHub Action](integrations.md#github-actions) as the `review` and
`review-max-age` inputs, and every [build plugin](integrations.md) as `review` and
`reviewMaxAge`. Neither ever changes whether a build fails — a review is a claim beside
what the run measured, never a verdict on it.

## What it does not reach yet

- **The statement does not read the record.** `eaa-kit statement` takes its conformance
  claim from the config file, as it always has. Wiring a review into a legal document needs
  the same care as adding a country, and it is not done.
- **SARIF carries the counts, not the detail.** A criterion nobody has reviewed is not a
  defect at a source location, so nothing here ever becomes an alert; the three counts sit
  in the log's `run.properties`, where the unevaluated counts already do, so a log with no
  results is not read as "everything was checked". The criterion-by-criterion detail is in
  the JSON report.
- **A review is not tied to a version of the site.** It ages by the calendar, not by what
  changed. A record from before a redesign is stale in every sense that matters and only
  `--review-max-age` will say so.
