import fg from 'fast-glob';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import type { Config, UnusedFile } from '../types.js';
import { minimatch } from 'minimatch';

/**
 * Scan for unused source files (.ts, .tsx, .js, .jsx)
 */
export async function scanUnusedFiles(config: Config): Promise<{ total: number; used: number; unused: number; files: UnusedFile[] }> {
  const cwd = config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  // 1. Find all potential source files
  const allFiles = await fg(extGlob, {
    cwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

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
    '**/*.test.{ts,tsx,js,jsx}',   // Tests are entry points
    '**/*.spec.{ts,tsx,js,jsx}',   // Tests are entry points
    'scripts/**/*.{ts,js}',
    'cypress/**/*.{ts,js,tsx}',
    '**/public/sw.js',
    '**/sw.{js,ts}',
    '**/main.{ts,js}',
    'api/index.ts',
    '**/app.module.ts',
    '**/api/index.ts'
  ];

  for (const file of allFiles) {
    const isEntry = entryPatterns.some(pattern => {
       return minimatch(file, pattern, { dot: true });
    });
    
    if (isEntry) entryFiles.add(file);
  }

  // 3. Track usage by resolving imports
  const usedFiles = new Set<string>(entryFiles);
  const queue = Array.from(entryFiles);
  const visited = new Set<string>(entryFiles);

  const importRegex = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    const currentDir = dirname(join(cwd, currentFile));

    try {
      const content = readFileSync(join(cwd, currentFile), 'utf-8');
      let match;
      importRegex.lastIndex = 0;
      
      while ((match = importRegex.exec(content)) !== null) {
        const imp = match[1] || match[2] || match[3];
        if (!imp) continue;

        let resolvedFile: string | null = null;

        // Resolve relative import
        if (imp.startsWith('.')) {
          resolvedFile = resolveImport(currentDir, imp, extensions, cwd);
        } 
        // Resolve alias import (@/ or ~/)
        else if (imp.startsWith('@/') || imp.startsWith('~/')) {
          const aliasPath = imp.substring(2);
          
          // 1. Try global roots (default)
          resolvedFile = resolveImport(cwd, aliasPath, extensions, cwd) || 
                         resolveImport(join(cwd, 'src'), aliasPath, extensions, cwd) ||
                         resolveImport(join(cwd, 'app'), aliasPath, extensions, cwd);
          
          // 2. Try project-local root (for monorepos)
          // If the current file is in a project subdirectory (e.g., apps/web), 
          // try resolving the alias relative to that project's root.
          if (!resolvedFile) {
            const pathParts = currentFile.split(/[/\\]/);
            // Check if it's in a standard monorepo structure like apps/name or packages/name
            if (pathParts.length >= 2 && (pathParts[0] === 'apps' || pathParts[0] === 'packages')) {
              const projectRoot = join(cwd, pathParts[0], pathParts[1]);
              resolvedFile = resolveImport(projectRoot, aliasPath, extensions, cwd) ||
                             resolveImport(join(projectRoot, 'src'), aliasPath, extensions, cwd) ||
                             resolveImport(join(projectRoot, 'app'), aliasPath, extensions, cwd);
            }
          }
        }

        if (resolvedFile && allFilesSet.has(resolvedFile)) {
          usedFiles.add(resolvedFile);
          if (!visited.has(resolvedFile)) {
            visited.add(resolvedFile);
            queue.push(resolvedFile);
          }
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  // 4. Collect unused
  const unusedResults: UnusedFile[] = [];
  for (const file of allFiles) {
    if (!usedFiles.has(file)) {
      const fullPath = join(cwd, file);
      try {
        const stats = statSync(fullPath);
        unusedResults.push({
          path: file,
          size: stats.size
        });
      } catch {
        unusedResults.push({ path: file, size: 0 });
      }
    }
  }

  return {
    total: allFiles.length,
    used: usedFiles.size,
    unused: unusedResults.length,
    files: unusedResults
  };
}

/**
 * Resolve an import path to a relative project path
 */
function resolveImport(baseDir: string, impPath: string, extensions: string[], rootDir: string): string | null {
  const target = resolve(baseDir, impPath);
  
  // Try direct file matches
  for (const ext of extensions) {
    const fileWithExt = target + ext;
    if (existsSync(fileWithExt)) {
      return relative(rootDir, fileWithExt).split(sep).join('/');
    }
  }

  // Try index files
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const ext of extensions) {
      const indexFile = join(target, 'index' + ext);
      if (existsSync(indexFile)) {
        return relative(rootDir, indexFile).split(sep).join('/');
      }
    }
  }

  // If path already has extension
  if (existsSync(target) && !statSync(target).isDirectory()) {
     return relative(rootDir, target).split(sep).join('/');
  }

  return null;
}
