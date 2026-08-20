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

The README quotes excerpts; these are the complete documents, which is the
easier way to check the JSON contract against your own tooling.

Regenerate them with:

```bash
pnpm examples
```

They are checked in so the formats can be reviewed without running anything.
Expect `generatedAt` and `endTimeUtc` to change on every regeneration; nothing
else should move unless the output itself changed.
