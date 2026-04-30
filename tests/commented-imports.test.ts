import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedFiles } from '../src/scanners/unused-files.js';
import { stripComments } from '../src/utils.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for the false-negative caused by commented-out imports.
 *
 * Bug: pruny's import regex ran against raw file content. A commented-out
 * import such as "// import Foo from './_components/foo'" was treated as an
 * active reference, so foo.tsx was never flagged even though it had no real
 * usage anywhere.
 *
 * Fix: strip single-line (//) and block (slash-star) comments from the
 * content BEFORE running the import regex. This is done in-memory — the
 * source files on disk are never modified.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/commented-imports');

function makeConfig(dir: string = fixtureBase): Config {
  return {
    dir,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

beforeAll(() => {
  mkdirSync(join(fixtureBase, 'app/other'), { recursive: true });
  mkdirSync(join(fixtureBase, '_components'), { recursive: true });

  // Entry point page — only references foo/bar via commented-out imports.
  // After stripping comments, there should be no active import of either,
  // so both foo.tsx and bar.tsx must appear in the unused report.
  //
  // We build the content from parts to avoid confusing Bun's own parser
  // with comment-like sequences inside template literals.
  const slashSlash = String.fromCharCode(47, 47);
  const slashStar = String.fromCharCode(47, 42);
  const starSlash = String.fromCharCode(42, 47);
  const pageContent = [
    slashSlash + " import Foo from '../_components/foo';",
    slashStar + " import Bar from '../_components/bar'; " + starSlash,
    "export default function Page() { return null; }",
  ].join('\n');
  writeFileSync(join(fixtureBase, 'app/page.tsx'), pageContent);

  // foo.tsx — dead code; only "referenced" from a // comment above
  writeFileSync(join(fixtureBase, '_components/foo.tsx'), 'export default function Foo() { return null; }\n');

  // bar.tsx — dead code; only "referenced" from a block comment above
  writeFileSync(join(fixtureBase, '_components/bar.tsx'), 'export default function Bar() { return null; }\n');

  // baz.tsx — genuinely used (active import, not commented out)
  writeFileSync(join(fixtureBase, '_components/baz.tsx'), 'export default function Baz() { return null; }\n');

  // another page that actively imports baz so it stays reachable.
  // Must match an entry pattern — use app/other/page.tsx.
  writeFileSync(join(fixtureBase, 'app/other/page.tsx'), "import Baz from '../../_components/baz';\nexport default function Other() { return null; }\n");
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

// ── Unit tests for the stripComments utility ──────────────────────────────────

describe('stripComments utility', () => {
  it('removes trailing single-line comments on a code line', () => {
    const slashSlash = String.fromCharCode(47, 47);
    const input = "import Foo from './foo'; " + slashSlash + " unused\nconst x = 1;";
    const result = stripComments(input);
    expect(result).not.toContain(slashSlash + ' unused');
    expect(result).toContain('const x = 1;');
  });

  it('removes a fully commented-out import line', () => {
    const slashSlash = String.fromCharCode(47, 47);
    const input = slashSlash + " import Foo from './foo';\nimport Bar from './bar';";
    const result = stripComments(input);
    expect(result).not.toContain("import Foo from './foo'");
    expect(result).toContain("import Bar from './bar'");
  });

  it('removes single-line block comments', () => {
    const slashStar = String.fromCharCode(47, 42);
    const starSlash = String.fromCharCode(42, 47);
    const input = slashStar + " import Foo from './foo'; " + starSlash + " const x = 1;";
    const result = stripComments(input);
    expect(result).not.toContain("import Foo from './foo'");
    expect(result).toContain('const x = 1;');
  });

  it('removes multiline block comments', () => {
    const slashStar = String.fromCharCode(47, 42);
    const starSlash = String.fromCharCode(42, 47);
    const input = slashStar + "\n * import Foo from './foo';\n " + starSlash + "\nconst x = 1;";
    const result = stripComments(input);
    expect(result).not.toContain("import Foo from './foo'");
    expect(result).toContain('const x = 1;');
  });

  it('preserves active imports that are not commented out', () => {
    const input = "import Foo from './foo';\nconst x = 1;";
    expect(stripComments(input)).toContain("import Foo from './foo'");
  });

  it('preserves the same number of newlines (line structure)', () => {
    const slashSlash = String.fromCharCode(47, 47);
    const input = "line1\n" + slashSlash + " comment\nline3\n";
    const result = stripComments(input);
    // comment body is removed but the newline character is kept
    expect(result.split('\n').length).toBe(input.split('\n').length);
  });
});

// ── Integration tests: scanner must flag commented-import files as unused ─────

describe('scanUnusedFiles: commented-out imports must not count as references', () => {
  it('flags foo.tsx as unused when only referenced inside a single-line comment', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).toContain('_components/foo.tsx');
  });

  it('flags bar.tsx as unused when only referenced inside a block comment', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).toContain('_components/bar.tsx');
  });

  it('does NOT flag baz.tsx because it has an active import', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('_components/baz.tsx');
  });
});
