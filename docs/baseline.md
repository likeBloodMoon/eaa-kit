# Baselines

The first run on a site that already exists finds everything at once. The build goes red,
and the only ways out are to fix all of it before merging anything or to turn the tool
off. A baseline is the third way: write down what is already wrong, fail on what is new.

```bash
eaa-kit baseline ./dist                     # record what the build already has
git add eaa-baseline.json
eaa-kit audit ./dist --baseline eaa-baseline.json
```

That second command now exits 0 for the violations in the file and 1 for anything else.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--output <path>` | `eaa-baseline.json` | Where to write it |
| `--note <text>` | — | Recorded on every entry, for whoever reads the file |
| `--expires-on <date>` | — | ISO date after which the entries stop suppressing |
| `--include`, `--exclude`, `--base-url`, `--browser`, `--concurrency` | | As for `audit` |

It is a separate subcommand rather than a flag on `audit`, deliberately. Accepting a set
of violations is a decision made once and committed to a file other people read; folding
it into the command that checks them would make it easy to type by reflex the moment a
build goes red, which is exactly when it should take a deliberate act.

## What it will not do

A baseline is one edit away from being a way to switch the tool off, so it is built not
to become one.

- **An accepted violation is still reported.** It moves out of the count that fails the
  build and into a section of its own, in all four formats. It never becomes a pass, and
  it is never simply absent — a barrier somebody agreed to defer is not a criterion that
  was met.
- **A page whose violations were all accepted is not called clean.** The console says
  `no new violations`, not `no violations`, and the HTML report says the same.
- **Matching is exact.** An entry suppresses the element it was recorded against and
  nothing else: same page, same rule, same element. Accepting one image without alt text
  does not accept the next one, and the same markup on another page still fails.
- **Entries that stop matching are reported**, so the file shrinks as things are fixed
  instead of rotting. Fixing a violation leaves a line to delete, which is the point.
- **`--expires-on` makes the acceptance temporary.** After that date the entries suppress
  nothing and the build goes red again. Nothing here is permanent unless somebody keeps
  deciding it is.
- **A baseline is never written from a run that could not finish.** If a page could not be
  audited, the run had no verdict to record.

## The file

```jsonc
{
  "schemaVersion": 1,
  "createdOn": "2026-08-27",
  "entries": [
    {
      "page": "index.html",
      "ruleId": "image-alt",
      "fingerprint": "f0e17d2582e9a5b3",   // rule + selector + markup, not the path
      "selector": "img",                    // the rest is for whoever reads the file
      "help": "Images must have alternative text",
      "impact": "critical",
      "acceptedOn": "2026-08-27",
      "expiresOn": "2026-12-31",            // optional
      "note": "agreed with the client"      // optional
    }
  ]
}
```

The fingerprint deliberately excludes the page path — it is the same one SARIF uses — so
moving a page does not invalidate the entry's identity, though the `page` field does have
to match. Entries are sorted, so the file diffs cleanly and two people regenerating it get
the same result.

## In code scanning

With `--format sarif`, accepted violations are emitted as SARIF `suppressions` rather than
being dropped. GitHub shows a suppressed result as closed instead of hiding it, which is
exactly what an accepted violation is: on the record, not failing the build.
