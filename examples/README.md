# examples

Full reports in each output format, generated from the test fixtures in
[`tests/fixtures/site`](../tests/fixtures/site) — a small site carrying known
violations at two impact levels, one rule needing manual review, and five rules
this engine cannot evaluate.

| File | Produced by |
| --- | --- |
| [`console.txt`](console.txt) | `eaa-kit audit tests/fixtures/site` |
| [`report.json`](report.json) | `… --format json` |
| [`report.sarif`](report.sarif) | `… --format sarif` |
| [`report.html`](report.html) | `… --format html` |
| [`baseline.json`](baseline.json) | `eaa-kit baseline tests/fixtures/site` |

The statements come from [`eaa.config.json`](eaa.config.json), which is a complete
config with every optional field filled in:

| File | Produced by |
| --- | --- |
| [`statement.de.md`](statement.de.md) | `eaa-kit statement --lang de` |
| [`statement.en.md`](statement.en.md) | `… --lang en` |
| [`statement.de.html`](statement.de.html) | `… --lang de --output …html` |
| [`statement.fr.md`](statement.fr.md) | `… --country FR --lang fr` |
| [`statement.audit.de.md`](statement.audit.de.md) | `… --audit examples/report.json` |

The French one is generated from the same Austrian config, which is why a French
document lists barriers written in German: the prose belongs to whoever wrote the
config, and the template never translates it. `statement.en.md` has the same
property. What changes with the country is the statute, the enforcement section
and the language of everything the template itself says.

The last one lists the barriers from the audit report next to it, in the form the
statement gives them — English rule text and all, which is exactly why it is
labelled in the document as coming from a tool.

The README quotes excerpts; these are the complete documents, which is the
easier way to check the JSON contract against your own tooling.

Regenerate them with:

```bash
pnpm examples
```

They are checked in so the formats can be reviewed without running anything.
Expect `generatedAt` and `endTimeUtc` to change on every regeneration; nothing
else should move unless the output itself changed.
