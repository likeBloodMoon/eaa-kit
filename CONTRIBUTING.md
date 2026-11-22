# Contributing to eaa-kit

Thanks for wanting to help. Bug reports, fixes, new stacks, corrections to a country's
statement and native-speaker reviews are all welcome. This page says how to set up the
repository, what a change needs before it is merged, and what the project will not take.

For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Setting up

You need Node 22.22, 24.15, or 26 or newer, and pnpm 10 (the exact version is pinned in
`packageManager`, so `corepack enable` picks it up).

```bash
git clone https://github.com/likeBloodMoon/eaa-kit.git
cd eaa-kit
corepack enable
pnpm install
npx playwright install chromium   # only for the browser-mode tests
```

The commands you will use:

| Command | What it does |
| --- | --- |
| `pnpm test` | The whole test suite (vitest) |
| `pnpm lint` | Biome, for lint and formatting; `pnpm format` fixes what it can |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | Builds `dist/` with tsdown |
| `pnpm smoke` | Builds, then runs the real CLI through every command against the fixtures |
| `pnpm examples` | Regenerates `examples/`, the checked-in output of every format |
| `pnpm bench` | Timings for this checkout on your machine |
| `pnpm release:check` | What has to be true before a version is tagged |

Run the CLI from source after a build with `node dist/cli/index.js audit tests/fixtures/site`.

## Before you open a pull request

CI runs lint, typecheck, the tests and the smoke run on Linux with Node 22, 24 and 26, and
on Windows and macOS with Node 24. Run them locally first:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm smoke
```

A few habits keep the project the way it is:

- **Write the failing check first.** A change is done when the test that describes it
  passes, and that test exists before the change does. A bug fix comes with a test that
  fails without it.
- **Regenerate `examples/` when output changes.** Run `pnpm examples` and commit the result.
  The diff is how a reviewer sees what a reader of the report will see. If `examples/`
  changes and your pull request did not mean to change output, something is wrong.
- **Snapshots are reviewed, not updated blindly.** The statement snapshots under
  `tests/statement/__snapshots__` are the legal documents people publish. Read the diff.
- **Never say more than the run measured.** The tool's one rule is that it reports what it
  found and says what it never looked at. A change must not make a run look more complete
  than it was, count something nobody checked, or report an unevaluated rule as a pass.
- **Comments explain why.** The codebase leans on comments that give the reason for a
  decision, often the bug that led to it. Keep that up in what you add.
- **Use conventional commit prefixes**: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`,
  `refactor:`, `test:`, with a scope where it helps (`fix(crawl): …`). The body says what
  changed and why.
- **Add a CHANGELOG entry** under the next version for anything a user would notice.

A compaction pass (folding duplication, removing indirection with one caller) follows
[the ponytail skill](.claude/skills/ponytail/SKILL.md): behaviour must stay identical, and
`pnpm examples` proves it.

## Releasing

For the maintainer. A release is a merged pull request that bumps `version`, dates its
CHANGELOG heading and runs `pnpm examples`; `pnpm release:check vX.Y.Z` says what is
missing. Then:

1. Push the tag, or publish a GitHub release that creates it: `git tag vX.Y.Z && git push
   origin vX.Y.Z`.
2. The Release workflow runs every check again and **stages** the version on npm. It
   authenticates as a trusted publisher and is not allowed to publish on its own.
3. Approve it: on npmjs.com under the package's staged versions, or with
   `npm stage list eaa-kit` and `npm stage approve <id>`. Either asks for 2FA. Until then
   nothing is public; `npm stage reject <id>` throws a bad one away.

## Kinds of contribution

**A stack eaa-kit does not recognise.** Add it to the registry in `src/audit/frameworks.ts`
with its detection signal, output directory and server port, and add a fixture under
`tests/fixtures/stacks/` with the answer `eaa-kit detect` must give for it.

**A correction to a statement.** Each country's text lives in
`src/statement/templates/<country>.<language>.md`, and
[docs/citations.md](docs/citations.md) records which official text each claim was checked
against. A correction should cite the primary source (the statute, the regulator's own
page or the official gazette), not a summary of it, and update `docs/citations.md` to
match.

**A native-speaker review.** The Czech, Danish, Finnish, Swedish, Polish and Portuguese
statements were written without a native speaker's review, and those reviews are wanted
before 1.0. Read the template, then open an issue or pull request with what reads wrong.
You do not need to touch any code.

**A new country.** Not before 1.0: fifteen is the scope for now. See the ROADMAP.

## What the project will not take

These were decided on purpose, and the reasons are in [ROADMAP.md](ROADMAP.md):

- writing fixes into a project's source files;
- a score or a percentage of WCAG met;
- Level AAA;
- anything model-generated in the advice or the statement;
- a hosted dashboard.

If you are unsure whether something fits, open an issue first and describe the problem you
want solved. That saves you writing code for something that cannot be merged.

## License

By contributing you agree that your contribution is licensed under the MIT license, as the
rest of the project is.
