import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { scanBrokenLinks } from '../src/scanners/broken-links.js';
import type { Config } from '../src/types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

/**
 * Regression test for: detect broken concrete slugs against
 * generateStaticParams-resolved values.
 *
 * Real-world case: start_business app has /services/[slug] with
 *   `return Object.keys(servicesData).map(slug => ({ slug }))`
 * Hard-coded link `/services/foo-bar` to a non-existent slug should be flagged.
 */

const fixtureBase = join(import.meta.dir, 'fixtures/static-params-test');

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: fixtureBase,
    ignore: { routes: [], folders: ['**/node_modules/**'], files: [], links: [] },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    ...overrides,
  };
}

beforeAll(() => {
  mkdirSync(join(fixtureBase, 'app/services/[slug]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/blog/[id]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/docs/[topic]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'app/users/[uid]'), { recursive: true });
  mkdirSync(join(fixtureBase, 'data'), { recursive: true });
  mkdirSync(join(fixtureBase, 'src'), { recursive: true });

  // Case 1: Object.keys(IDENT) where IDENT is re-exported from a JSON file
  writeFileSync(
    join(fixtureBase, 'data/services.json'),
    JSON.stringify({ 'llp': {}, 'pvt-ltd': {}, 'gst': {} }),
  );
  writeFileSync(
    join(fixtureBase, 'data/index.ts'),
    `import servicesData from './services.json';\nexport { servicesData };`,
  );
  writeFileSync(
    join(fixtureBase, 'app/services/[slug]/page.tsx'),
    `import { servicesData } from '@/data';
export async function generateStaticParams() {
  return Object.keys(servicesData).map((slug) => ({ slug }));
}
export default function Page() { return null; }`,
  );

  // Case 2: literal array of objects
  writeFileSync(
    join(fixtureBase, 'app/blog/[id]/page.tsx'),
    `export function generateStaticParams() {
  return [{ id: "hello" }, { id: "world" }];
}
export default function Page() { return null; }`,
  );

  // Case 3: string-array .map
  writeFileSync(
    join(fixtureBase, 'app/docs/[topic]/page.tsx'),
    `export function generateStaticParams() {
  return ["intro", "guide"].map((topic) => ({ topic }));
}
export default function Page() { return null; }`,
  );

  // Case 4: NO generateStaticParams — should fall back to permissive matching
  writeFileSync(
    join(fixtureBase, 'app/users/[uid]/page.tsx'),
    `export default function Page() { return null; }`,
  );

  // tsconfig with @/ alias
  writeFileSync(
    join(fixtureBase, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./*'] } },
    }),
  );

  // Source file with broken + valid links
  writeFileSync(
    join(fixtureBase, 'src/links.tsx'),
    `import Link from 'next/link';
export function L() {
  return <div>
    <Link href="/services/llp">valid</Link>
    <Link href="/services/intellectual-property">broken — not in static params</Link>
    <Link href="/blog/hello">valid blog</Link>
    <Link href="/blog/missing">broken blog</Link>
    <Link href="/docs/intro">valid docs</Link>
    <Link href="/docs/missing-doc">broken docs</Link>
    <Link href="/users/anything">permissive — no static params</Link>
  </div>;
}`,
  );
});

afterAll(() => {
  try { rmSync(fixtureBase, { recursive: true, force: true }); } catch {}
});

describe('broken-links: generateStaticParams resolution', () => {
  it('flags concrete slug not in resolved Object.keys()', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const paths = result.links.map(l => l.path);
    expect(paths).toContain('/services/intellectual-property');
  });

  it('does not flag valid slug from resolved Object.keys()', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const paths = result.links.map(l => l.path);
    expect(paths).not.toContain('/services/llp');
  });

  it('flags concrete value not in literal-array generateStaticParams', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const paths = result.links.map(l => l.path);
    expect(paths).toContain('/blog/missing');
    expect(paths).not.toContain('/blog/hello');
  });

  it('flags concrete value not in string-array .map generateStaticParams', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const paths = result.links.map(l => l.path);
    expect(paths).toContain('/docs/missing-doc');
    expect(paths).not.toContain('/docs/intro');
  });

  it('falls back to permissive matching when no generateStaticParams', async () => {
    const result = await scanBrokenLinks(makeConfig());
    const paths = result.links.map(l => l.path);
    expect(paths).not.toContain('/users/anything');
  });
});
