# eaa-kit

Build-time WCAG 2.2 AA auditor + EU accessibility statement generator for static sites.
Aimed at freelancers and small agencies in the DACH region who must comply with the
European Accessibility Act (enforceable since 28 June 2025) / BFSG (DE) / BaFG (AT).

## What this is NOT

- Not a browser extension, not a hosted SaaS, not an overlay widget.
- Not legal advice. Every generated document carries a disclaimer.
- Not a reimplementation of axe-core. We wrap it.

## Core value proposition

Two commands, one config file:

```bash
npx eaa-kit audit ./dist          # WCAG 2.2 AA report over built HTML
npx eaa-kit statement             # generates Barrierefreiheitserklärung (DE/EN)
```

Existing tools do one or the other, and none are DACH-localised. That gap is the product.

## Tech decisions (already made — do not re-litigate)

| Concern | Decision |
|---|---|
| Language | TypeScript, strict mode |
| Module system | ESM only (`"type": "module"`) |
| Node | >= 20 |
| Build | `tsdown` (or `tsup` if tsdown misbehaves) |
| CLI framework | `commander` |
| Test runner | `vitest` |
| Lint/format | `biome` (one tool, zero config fights) |
| License | MIT |
| Package manager | `pnpm` |
| Repo | single package, NOT a monorepo |

### Audit engine — the important architectural call

Default mode is **browserless**: glob HTML files out of the build directory, parse with
`jsdom`, run `axe-core` against the resulting DOM. Fast, no Chromium download, works in CI.

Trade-off to document honestly in the README: rules requiring layout or computed style
(colour contrast, target size, reflow) cannot run in jsdom and are reported as
`incomplete`, never as `pass`.

Optional `--browser` flag uses Playwright chromium for full rule coverage. Playwright is
an **optional peer dependency** — never a hard install cost for the default path.

This split is a genuine differentiator. Do not collapse it into "just use Playwright".

## Config file

`eaa.config.ts` (also accept `.js`, `.json`) at project root:

```ts
import { defineConfig } from 'eaa-kit'

export default defineConfig({
  site: {
    name: 'Musterbetrieb',
    url: 'https://example.at',
    locale: 'de-AT',
  },
  provider: {
    legalName: 'Musterbetrieb GmbH',
    email: 'office@example.at',
    phone: '+43 ...',
    address: '...',
  },
  compliance: {
    status: 'partially-compliant',   // 'compliant' | 'partially-compliant' | 'non-compliant'
    standard: 'EN 301 549',
    knownIssues: [],
    assessedOn: '2026-08-20',
    assessmentMethod: 'self-assessment',
  },
  enforcement: {
    country: 'AT',  // drives which supervisory body + statute text is used
  },
})
```

Country templates needed: `AT`, `DE`, `CH`. Statement output in `de` and `en`.

## Directory layout

```
src/
  cli/
    index.ts          # commander setup, version, help
    audit.ts          # audit subcommand
    statement.ts      # statement subcommand
  audit/
    collect.ts        # glob HTML files from a build dir
    runners/
      jsdom.ts        # default engine
      playwright.ts   # optional engine
    report/
      console.ts      # human-readable table
      json.ts
      html.ts
  statement/
    render.ts
    templates/
      at.de.md  at.en.md
      de.de.md  de.en.md
      ch.de.md  ch.en.md
  config/
    define.ts         # defineConfig + zod schema
    load.ts
tests/
  fixtures/           # tiny HTML files with known violations
examples/
```

## Milestones

- **M1 (tonight):** repo scaffold + `audit` runs end-to-end on a real `dist/` and prints a
  violation table. Vertical slice, ugly output is fine.
- **M2:** JSON + HTML report output, exit codes, `--threshold` for CI.
- **M3:** statement generator, AT/DE templates, DE/EN.
- **M4:** Astro integration wrapper (`eaa-kit/astro`), CH template, README polish, launch.

## Working agreements for Claude Code

- Commit after each working increment, conventional commits (`feat:`, `fix:`, `chore:`).
- Write the test alongside the feature, not after. Fixtures over mocks.
- No new dependency without stating why in the commit message.
- Never mark a WCAG rule as passing when the engine could not actually evaluate it.
- Keep the CLI output readable on a narrow terminal — no wide tables.
- German-language strings live in template files, never inline in TypeScript.
- When a legal claim is made in output text, cite the statute in a code comment
  (§ 5 ECG / § 14 UGB for AT, § 5 DDG for DE, EN 301 549 for the technical standard).

## Dogfood targets

Run every audit change against at least one real, deployed build before committing —
not just the fixtures. The current rotation is a restaurant site, a booking site and a
personal site.

Keep the specific domains out of this repository. It is public, and naming a client
alongside their site's accessibility defects is the client's call to make, not a detail
to leave lying in a config file. Their audit output is likewise not `examples/` material
without asking first.
