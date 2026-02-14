import fg from 'fast-glob';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import type { Config, UnusedFile } from '../types.js';
import { minimatch } from 'minimatch';

/**
 * Scan for unused source files (.ts, .tsx, .js, .jsx)
 */
export async function scanUnusedFiles(config: Config): Promise<{ total: number; used: number; unused: number; files: UnusedFile[] }> {
  const rootDir = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
  const searchDir = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  console.log(`\n   🔍 Finding source files in: ${searchDir}`);

  // 1. Find all potential source files (Candidates)
  // We want to find unused files ONLY in searchDir
  const allFiles = await fg(extGlob, {
    cwd: searchDir,
    ignore: [...config.ignore.folders, ...config.ignore.files],
    absolute: true // Work with absolute paths to avoid confusion
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
    '**/*.{test,spec,e2e-spec}.{ts,tsx,js,jsx}',
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

  const importRegex = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;

  while (queue.length > 0) {
    const currentFile = queue.shift()!;
    const currentDir = dirname(currentFile); // currentFile is now absolute

    try {
      const content = readFileSync(currentFile, 'utf-8');
      let match;
      importRegex.lastIndex = 0;
      
      while ((match = importRegex.exec(content)) !== null) {
        const imp = match[1] || match[2] || match[3];
        if (!imp) continue;

        let resolvedFile: string | null = null;

        // Resolve relative import
        if (imp.startsWith('.')) {
          resolvedFile = resolveImport(currentDir, imp, extensions, rootDir);
        } 
        // Resolve alias import (@/ or ~/)
        else if (imp.startsWith('@/') || imp.startsWith('~/')) {
          const aliasPath = imp.substring(2);
          
          // 1. Try global roots
          resolvedFile = resolveImport(rootDir, aliasPath, extensions, rootDir) || 
                         resolveImport(join(rootDir, 'src'), aliasPath, extensions, rootDir) ||
                         resolveImport(join(rootDir, 'app'), aliasPath, extensions, rootDir);
          
          // 2. Try project-local root (for monorepos)
          if (!resolvedFile) {
            // Naive check: walk up from current file to find a package.json?
            // Or use the known logic if we are assuming a structure.
            // Let's rely on standard resolution + rootDir first.
            
            // If we are in an app, maybe we can find the app root from the file path?
            // simple check: split by 'apps' or 'packages'
            const pathParts = currentFile.split(sep);
            const appsIndex = pathParts.lastIndexOf('apps');
            const packagesIndex = pathParts.lastIndexOf('packages');
            const index = Math.max(appsIndex, packagesIndex);
            
            if (index !== -1 && index + 1 < pathParts.length) {
                const projectRoot = pathParts.slice(0, index + 2).join(sep);
                resolvedFile = resolveImport(projectRoot, aliasPath, extensions, rootDir) ||
                               resolveImport(join(projectRoot, 'src'), aliasPath, extensions, rootDir) ||
                               resolveImport(join(projectRoot, 'app'), aliasPath, extensions, rootDir);
            }
          }
        }

        if (resolvedFile) {
           // resolveImport returns path relative to rootDir (legacy behavior?)
           // Wait, I need to check resolveImport implementation below.
           // It returns `relative(rootDir, fileWithExt).split(sep).join('/')`.
           // But now we are working with ABSOLUTE paths in `allFilesSet`.
           
           // We should modify resolveImport to return ABSOLUTE path, or convert here.
           const absoluteResolved = join(rootDir, resolvedFile);

           // BUT wait, if resolveImport returns relative path, `join` works.
           // However, if the file is OUTSIDE rootDir (??), relative might start with ../
           
           // Better: Convert `allFilesSet` to verify.
           // Currently `allFiles` are absolute. 
           // `resolvedFile` is relative to `rootDir`.
           
           const absoluteTarget = resolve(rootDir, resolvedFile);
           
           // Note: `usedFiles` should track everything we touch, even if outside `allFilesSet` (searchDir).
           // But `scanUnusedFiles` logic only reports unused if it IS in `allFilesSet`.
           // We just need to queue it if we haven't visited it.
           
           // If we visited it, assume it was processed.
           // IMPORTANT: If we import a file OUTSIDE `searchDir`, we should still parse it to find its imports!
           // Because it might import something INSIDE `searchDir` (circular?) or we just need to be correct.
           
           if (!visited.has(absoluteTarget) && existsSync(absoluteTarget) && statSync(absoluteTarget).isFile()) {
               visited.add(absoluteTarget);
               usedFiles.add(absoluteTarget);
               queue.push(absoluteTarget);
           } else {
               usedFiles.add(absoluteTarget); // Mark as used even if visited or not in our scan list
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
      // Return relative path for report
      const displayPath = relative(rootDir, file);
      try {
        const stats = statSync(file);
        unusedResults.push({
          path: displayPath,
          size: stats.size
        });
      } catch {
        unusedResults.push({ path: displayPath, size: 0 });
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
