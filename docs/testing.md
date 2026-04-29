# Testing & Local Iteration

## Run tests

```bash
bun test                # all tests (uses bun:test)
bun test tests/foo.test.ts   # one file
bun run validate        # lint + tsc --noEmit + tests
```

Fixtures live in `tests/fixtures/nextjs-app/` and per-test temp dirs.

## Test against a real project (no install needed)

```bash
bun run build
node dist/index.js --dir /path/to/project
node dist/index.js --dir /path/to/project --all   # CI mode (exit 1 on issues)
node dist/index.js --dir /path/to/project --fix   # auto-fix mode
```

Skip `bun link` during iteration — `node dist/index.js --dir <project>` runs the freshly built local scanner directly.

## Mandatory smoke tests after any change

After fixing a bug or adding a feature, **always** verify against these two real-world projects to catch regressions:

```bash
bun run build
node dist/index.js --dir /Users/webnaresh/coding-line/practice-stack --ignore-apps extension
node dist/index.js --dir /Users/webnaresh/coding-line/abhyaiska
```

Both must exit with 0 unused items (or only known/pre-existing issues). New false positives = investigate before pushing.

## Broken-links scanner specifics

To verify template-literal `${}` capture + gitignore-pattern handling after editing `src/scanners/broken-links.ts`, drop a scratch file into the target project and re-run:

```tsx
// <project>/app/__test_broken_links.tsx
import Link from "next/link";
const id = "x";
export const A = () => <Link href={`/does/not/exist/${id}`}>dead</Link>;
export const B = () => <Link href="/nope">static dead</Link>;
```

A correct run prints both under **Broken Internal Links**. If nothing surfaces:
- Run with `DEBUG_PRUNY=1` and look for `[TRACE POST]` lines — confirms regex captured the template literal.
- Check `isGitignoredPublicFile()` isn't flipping on negation patterns in `.gitignore` (lines starting with `!`). Those must be filtered out before feeding to minimatch — otherwise every unrelated path matches and broken detection silently no-ops.
- Template literals are normalized via `normalizePath()` → every `${...}` collapses to `[id]` so they align with Next.js dynamic-route segments.

Delete the scratch file after verifying.

## Bug-fix policy

Every bug fix MUST include a regression test:
1. Write a test in `tests/` that reproduces the exact bug
2. Add edge-case tests (different file formats, missing dirs, multiple matches, no matches)
3. Test must fail without the fix and pass with it
4. Run `bun run validate` before pushing
