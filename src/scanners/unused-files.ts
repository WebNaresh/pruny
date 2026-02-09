import fg from 'fast-glob';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, UnusedFile } from '../types.js';
import { minimatch } from 'minimatch';

/**
 * Scan for unused source files (.ts, .tsx, .js, .jsx)
 */
export async function scanUnusedFiles(config: Config): Promise<{ total: number; files: UnusedFile[] }> {
  const cwd = config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  // 1. Find all potential source files
  const allFiles = await fg(extGlob, {
    cwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  if (allFiles.length === 0) {
    return { total: 0, files: [] };
  }

  // 2. Identify Entry Points (files that are executed by framework/runners)
  const entryFiles = new Set<string>();
  const entryPatterns = [
    '**/page.{ts,tsx,js,jsx}',
    '**/layout.{ts,tsx,js,jsx}',
    '**/route.{ts,tsx,js,jsx}',
    '**/loading.{ts,tsx,js,jsx}',
    '**/error.{ts,tsx,js,jsx}',
    '**/not-found.{ts,tsx,js,jsx}',
    '**/middleware.{ts,js}',
    '**/instrumentation.{ts,js}',
    'next.config.{js,mjs,ts}',
    'tailwind.config.{js,ts}',
    'postcss.config.{js,ts}',
    'app/api/**',
    'app/robots.ts',
    'app/sitemap.ts',
    'next-sitemap.config.js',
    'cypress.config.ts',
    'env.d.ts',
    'next-env.d.ts',
    '**/*.d.ts',
    'scripts/**',
    'cypress/**',
    'public/sw.js'
  ];

  for (const file of allFiles) {
    const isEntry = entryPatterns.some(pattern => {
       return minimatch(file, pattern, { dot: true });
    });
    
    if (isEntry) entryFiles.add(file);
  }

  // 3. Scan all files for imports
  const importedPaths = new Set<string>();
  const importRegex = /from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)|require\(['"]([^'"]+)['"]\)/g;

  for (const file of allFiles) {
    try {
      const content = readFileSync(join(cwd, file), 'utf-8');
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        const imp = match[1] || match[2] || match[3];
        if (imp && (imp.startsWith('.') || imp.startsWith('@/') || imp.startsWith('~/'))) {
          // Normalize import path: remove extension
          const cleanImp = imp.replace(/\.(ts|tsx|js|jsx)$/, '');
          importedPaths.add(cleanImp);
          
          // Also track possible index imports
          if (cleanImp.endsWith('/')) {
             importedPaths.add(cleanImp + 'index');
          } else if (!cleanImp.includes('/')) {
             // Handle root relative imports if applicable
          }
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  // 4. Check usage
  const unusedResults: UnusedFile[] = [];
  
  for (const file of allFiles) {
    if (entryFiles.has(file)) continue;

    const fileBase = file.replace(/\.(ts|tsx|js|jsx)$/, '');
    const fileName = file.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') || '';
    
    // Check if any import path targets this file
    const isUsed = Array.from(importedPaths).some(imp => {
       // 1. Direct match: import path matches relative file path (naive)
       if (imp.endsWith(fileBase)) return true;
       
       // 2. Index match: import 'folder' targets 'folder/index.ts'
       if (fileName === 'index' && imp === fileBase.replace(/\/index$/, '')) return true;

       // 3. Alias match: @/components/Button matches src/components/Button
       if (imp.startsWith('@/') || imp.startsWith('~/')) {
          const strippedFile = fileBase.replace(/^(src|app)\//, '');
          if (imp.substring(2) === strippedFile) return true;
       }

       // 4. Fallback: Filename match (might be too loose, but good for relative)
       if (imp.endsWith('/' + fileName)) return true;

       return false;
    });

    if (!isUsed) {
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
    total: unusedResults.length,
    files: unusedResults
  };
}
