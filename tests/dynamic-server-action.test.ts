import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanUnusedFiles } from '../src/scanners/unused-files.js';
import { scanUnusedExports } from '../src/scanners/unused-exports.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression tests for Issue #38:
 * False positive when the reachability chain goes through a next/dynamic import
 * that contains a webpack magic comment (webpackChunkName: "...") followed
 * by a "use server" server-action file.
 *
 * Root cause: the import regex in unused-files.ts did not account for block
 * comments inside import(), so `import(/* comment *\/ './X')` was silently
 * skipped and everything downstream was treated as unreachable.
 *
 * Chain under test:
 *   app/page.tsx  (entry)
 *     → components/InputField.tsx              (static import)
 *       → components/InputEditorJS.tsx         (next/dynamic with magic comment)
 *         → components/actions/editor.action.ts  ("use server", static import)
 *           → lib/gemini_ai.ts                 ← must NOT be reported as unused
 */

const fixtureBase = join(import.meta.dir, 'fixtures/dynamic-server-action-test');

function makeConfig(): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  };
}

beforeAll(() => {
  // app/page.tsx — Next.js entry, statically imports InputField
  mkdirSync(join(fixtureBase, 'app'), { recursive: true });
  writeFileSync(
    join(fixtureBase, 'app/page.tsx'),
    `import InputField from '../components/InputField';\nexport default function Page() { return <InputField />; }\n`
  );

  // components/InputField.tsx — uses next/dynamic WITH a webpack magic comment
  // (the magic comment is the key trigger for the bug)
  mkdirSync(join(fixtureBase, 'components'), { recursive: true });
  writeFileSync(
    join(fixtureBase, 'components/InputField.tsx'),
    `import dynamic from 'next/dynamic';\n` +
    `const InputEditorJS = dynamic(() => import(/* webpackChunkName: "InputEditorJS" */ './InputEditorJS'));\n` +
    `export default function InputField() { return <InputEditorJS />; }\n`
  );

  // components/InputEditorJS.tsx — statically imports the server action
  writeFileSync(
    join(fixtureBase, 'components/InputEditorJS.tsx'),
    `import { generateEditorContent } from './actions/editor.action';\nexport default function InputEditorJS() { generateEditorContent('test'); return null; }\n`
  );

  // components/actions/editor.action.ts — "use server" file, imports gemini via @/ alias
  mkdirSync(join(fixtureBase, 'components/actions'), { recursive: true });
  writeFileSync(
    join(fixtureBase, 'components/actions/editor.action.ts'),
    `"use server";\nimport { gemini } from '@/lib/gemini_ai';\nexport async function generateEditorContent(prompt: string) {\n  return gemini.generateContent(prompt);\n}\n`
  );

  // lib/gemini_ai.ts — exports gemini; reachable via the chain above
  mkdirSync(join(fixtureBase, 'lib'), { recursive: true });
  writeFileSync(
    join(fixtureBase, 'lib/gemini_ai.ts'),
    `export const gemini = { generateContent: (p: string) => p };\n`
  );
});

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true });
});

describe('Issue #38: next/dynamic magic comment + "use server" chain reachability', () => {
  it('should not flag lib/gemini_ai.ts as an unused file', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('lib/gemini_ai.ts');
  });

  it('should not flag gemini as an unused export', async () => {
    const result = await scanUnusedExports(makeConfig(), [], { silent: true });
    const unusedNames = result.exports.map(e => e.name);
    expect(unusedNames).not.toContain('gemini');
  });

  it('components/InputEditorJS.tsx should be reachable (not flagged unused)', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('components/InputEditorJS.tsx');
  });

  it('components/actions/editor.action.ts should be reachable (not flagged unused)', async () => {
    const result = await scanUnusedFiles(makeConfig());
    const unusedPaths = result.files.map(f => f.path);
    expect(unusedPaths).not.toContain('components/actions/editor.action.ts');
  });

  it('edge case: dynamic import without magic comment still works', async () => {
    const edgeBase = join(fixtureBase, 'edge-no-comment');
    mkdirSync(join(edgeBase, 'app'), { recursive: true });
    mkdirSync(join(edgeBase, 'components'), { recursive: true });
    mkdirSync(join(edgeBase, 'lib'), { recursive: true });

    writeFileSync(join(edgeBase, 'app/page.tsx'), `import W from '../components/Wrapper';\nexport default function Page() { return null; }\n`);
    writeFileSync(join(edgeBase, 'components/Wrapper.tsx'), `import dynamic from 'next/dynamic';\nconst Widget = dynamic(() => import('./Widget'));\nexport default function Wrapper() { return null; }\n`);
    writeFileSync(join(edgeBase, 'components/Widget.tsx'), `import { helper } from '../lib/helper';\nexport default function Widget() { helper(); return null; }\n`);
    writeFileSync(join(edgeBase, 'lib/helper.ts'), `export function helper() { return 42; }\n`);

    const cfg: Config = { dir: edgeBase, ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] }, extensions: ['.ts', '.tsx', '.js', '.jsx'] };
    const result = await scanUnusedFiles(cfg);
    const unusedPaths = result.files.map(f => f.path);

    expect(unusedPaths).not.toContain('lib/helper.ts');
    expect(unusedPaths).not.toContain('components/Widget.tsx');

    rmSync(edgeBase, { recursive: true, force: true });
  });

  it('edge case: dynamic import with double-quoted magic comment', async () => {
    const edgeBase = join(fixtureBase, 'edge-double-quote-comment');
    mkdirSync(join(edgeBase, 'app'), { recursive: true });
    mkdirSync(join(edgeBase, 'components'), { recursive: true });
    mkdirSync(join(edgeBase, 'lib'), { recursive: true });

    writeFileSync(join(edgeBase, 'app/page.tsx'), `import W from '../components/Wrapper';\nexport default function Page() { return null; }\n`);
    writeFileSync(join(edgeBase, 'components/Wrapper.tsx'),
      `import dynamic from 'next/dynamic';\n` +
      `const Widget = dynamic(() => import(/* webpackChunkName: "Widget" */ "./Widget"));\n` +
      `export default function Wrapper() { return null; }\n`
    );
    writeFileSync(join(edgeBase, 'components/Widget.tsx'), `import { helper } from '../lib/helper';\nexport default function Widget() { helper(); return null; }\n`);
    writeFileSync(join(edgeBase, 'lib/helper.ts'), `export function helper() { return 42; }\n`);

    const cfg: Config = { dir: edgeBase, ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] }, extensions: ['.ts', '.tsx', '.js', '.jsx'] };
    const result = await scanUnusedFiles(cfg);
    const unusedPaths = result.files.map(f => f.path);

    expect(unusedPaths).not.toContain('lib/helper.ts');
    expect(unusedPaths).not.toContain('components/Widget.tsx');

    rmSync(edgeBase, { recursive: true, force: true });
  });

  it('edge case: multiple magic comments in one import', async () => {
    const edgeBase = join(fixtureBase, 'edge-multi-comment');
    mkdirSync(join(edgeBase, 'app'), { recursive: true });
    mkdirSync(join(edgeBase, 'components'), { recursive: true });
    mkdirSync(join(edgeBase, 'lib'), { recursive: true });

    writeFileSync(join(edgeBase, 'app/page.tsx'), `import W from '../components/Wrapper';\nexport default function Page() { return null; }\n`);
    writeFileSync(join(edgeBase, 'components/Wrapper.tsx'),
      `import dynamic from 'next/dynamic';\n` +
      `const Widget = dynamic(() => import(/* webpackChunkName: "Widget" */ /* webpackPrefetch: true */ './Widget'));\n` +
      `export default function Wrapper() { return null; }\n`
    );
    writeFileSync(join(edgeBase, 'components/Widget.tsx'), `import { helper } from '../lib/helper';\nexport default function Widget() { helper(); return null; }\n`);
    writeFileSync(join(edgeBase, 'lib/helper.ts'), `export function helper() { return 42; }\n`);

    const cfg: Config = { dir: edgeBase, ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] }, extensions: ['.ts', '.tsx', '.js', '.jsx'] };
    const result = await scanUnusedFiles(cfg);
    const unusedPaths = result.files.map(f => f.path);

    expect(unusedPaths).not.toContain('lib/helper.ts');
    expect(unusedPaths).not.toContain('components/Widget.tsx');

    rmSync(edgeBase, { recursive: true, force: true });
  });
});
