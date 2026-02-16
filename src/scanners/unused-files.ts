import fg from 'fast-glob';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import type { Config, UnusedFile } from '../types.js';
import { minimatch } from 'minimatch';

/**
 * Scan for unused source files (.ts, .tsx, .js, .jsx)
 * 
 * SCOPE:
 * - Candidates: Inside App Directory
 * - Usage Check: Inside App Directory (Local only, per user request)
 */
export async function scanUnusedFiles(config: Config): Promise<{ total: number; used: number; unused: number; files: UnusedFile[] }> {
  // Use appDir if specific scan, else config.dir
  const searchDir = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  process.stdout.write(`   📂 Scanning source files...`);

  // 1. Find all files in the search directory
  const allFiles = await fg(extGlob, {
    cwd: searchDir,
    ignore: [...config.ignore.folders, ...config.ignore.files],
    absolute: true
  });

  process.stdout.write(` ${allFiles.length} files found\n`);

  if (allFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, files: [] };
  }

  const allFilesSet = new Set(allFiles);

  // 2. Identify Entry Points
  const entryFiles = new Set<string>();
  const entryPatterns = [
    '**/page.{ts,tsx,js,jsx}',
    '**/layout.{ts,tsx,js,jsx}',
    '**/route.{ts,tsx,js,jsx}',
    '**/loading.{ts,tsx,js,jsx}',
    '**/error.{ts,tsx,js,jsx}',
    '**/not-found.{ts,tsx,js,jsx}',
    '**/template.{ts,tsx,js,jsx}',
    '**/default.{ts,tsx,js,jsx}', // Parallel routes
    '**/middleware.{ts,js}',
    '**/proxy.{ts,js}', // Proxy files are middleware-like entry points
    '**/instrumentation.{ts,js}',
    '**/next.config.{js,mjs,ts}',
    '**/tailwind.config.{js,ts,mjs,cjs}',
    '**/postcss.config.{js,ts,mjs,cjs}',
    '**/robots.{ts,js}',
    '**/sitemap.{ts,js}',
    '**/manifest.{ts,js}',
    '**/icon.{ts,tsx,js,jsx}',
    '**/apple-icon.{ts,tsx,js,jsx}',
    '**/opengraph-image.{ts,tsx,js,jsx}',
    '**/twitter-image.{ts,tsx,js,jsx}',
    '**/global-error.{ts,tsx,js,jsx}',
    '**/next-sitemap.config.{js,cjs}',
    '**/cypress.config.{ts,js}',
    '**/env.d.ts',
    '**/next-env.d.ts',
    '**/*.d.ts',
    '**/*.config.{js,ts,mjs,cjs}', // Generic config files
    '**/*.{test,spec,e2e-spec}.{ts,tsx,js,jsx}',
    'scripts/**/*.{ts,js}',
    'cypress/**/*.{ts,js,tsx}',
    '**/public/sw.js',
    '**/sw.{js,ts}',
    '**/main.{ts,js}',
    'api/index.ts',
    '**/app.module.ts',
    '**/*.module.ts', // Treat all modules as potential entry points to prevent graph breakage
    '**/api/index.ts',
    // Serverless/Lambda entry points (invoked by runtime, not imported by other code)
    '**/*lambda*/**/{index,handler}.{ts,js}',
    '**/*function*/**/{index,handler}.{ts,js}',
  ];

  // If the search directory itself is a Lambda/serverless app, add root entry patterns
  const searchDirName = searchDir.toLowerCase();
  if (searchDirName.includes('lambda') || searchDirName.includes('function') || searchDirName.includes('serverless')) {
    entryPatterns.push('{index,handler}.{ts,js}');
  }

  for (const file of allFiles) {
    const relPath = relative(searchDir, file);
    const isEntry = entryPatterns.some(pattern => {
       return minimatch(relPath, pattern, { dot: true });
    });

    if (isEntry) entryFiles.add(file);
  }

  // 3. Track usage by resolving imports
  const usedFiles = new Set<string>(entryFiles);
  const queue = Array.from(entryFiles);
  const visited = new Set<string>(entryFiles);

  // Enhanced regex to handle newlines and various import styles
  const importRegex = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    const currentDir = dirname(currentFile);

    try {
      const content = readFileSync(currentFile, 'utf-8');
      
      // normalize content to handle multiline imports better if needed, 
      // but standard regex `\s+` matches newlines, so we are good.
      // However, let's make sure we catch everything.
      
      let match;
      importRegex.lastIndex = 0;
      
      while ((match = importRegex.exec(content)) !== null) {
        const imp = match[1] || match[2] || match[3];
        if (!imp) continue;

        let resolvedFile: string | null = null;

        if (imp.startsWith('.')) {
          // Resolve relative to current file
          resolvedFile = resolveImportAbsolute(currentDir, imp, extensions);
        } else if (imp.startsWith('@/') || imp.startsWith('~/')) {
          const aliasPath = imp.substring(2);
          resolvedFile = resolveImportAbsolute(searchDir, aliasPath, extensions) ||
                         resolveImportAbsolute(join(searchDir, 'src'), aliasPath, extensions);
        }

        if (resolvedFile && allFilesSet.has(resolvedFile) && !visited.has(resolvedFile)) {
             usedFiles.add(resolvedFile);
             visited.add(resolvedFile);
             queue.push(resolvedFile);
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  const files: UnusedFile[] = allFiles
    .filter(f => !usedFiles.has(f))
    .map(f => {
      const s = statSync(f);
      return {
        path: relative(config.dir, f),
        size: s.size,
      };
    });

  return {
    total: allFiles.length,
    used: usedFiles.size,
    unused: files.length,
    files
  };
}

/**
 * Resolve an import path to an absolute path
 */
function resolveImportAbsolute(baseDir: string, impPath: string, extensions: string[]): string | null {
  const target = resolve(baseDir, impPath);
  
  // 1. Exact match (Priority: maybe imports file with extension)
  if (existsSync(target) && statSync(target).isFile()) return target;

  // 2. Direct file with extensions
  for (const ext of extensions) {
    const file = target + ext;
    if (existsSync(file) && statSync(file).isFile()) return file;
  }

  // 3. Directory index
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const ext of extensions) {
      const index = join(target, 'index' + ext);
      if (existsSync(index) && statSync(index).isFile()) return index;
    }
  }

  return null;
}
