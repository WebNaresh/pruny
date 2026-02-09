import fg from 'fast-glob';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractApiReferences, EXPORTED_METHOD_PATTERN, type ApiReference } from './patterns.js';
import type { Config, ApiRoute, ScanResult, VercelConfig } from './types.js';
import { minimatch } from 'minimatch';
import { scanPublicAssets } from './scanners/public-assets.js';
import { scanUnusedFiles } from './scanners/unused-files.js';
import { scanUnusedExports } from './scanners/unused-exports.js';

/**
 * Extract route path from file path
 * e.g., app/api/users/route.ts -> /api/users
 */
function extractRoutePath(filePath: string): string {
  // Remove src/ prefix if present
  let path = filePath.replace(/^src\//, '');

  // Remove app/ prefix
  path = path.replace(/^app\//, '');

  // Remove route.{ts,tsx,js,jsx} suffix
  path = path.replace(/\/route\.(ts|tsx|js|jsx)$/, '');

  path = path.replace(/\/route\.(ts|tsx|js|jsx)$/, '');

  return '/' + path;
}

/**
 * Extract exported HTTP methods from route file content
 */
function extractExportedMethods(content: string): string[] {
  const methods: string[] = [];
  let match;
  while ((match = EXPORTED_METHOD_PATTERN.exec(content)) !== null) {
    if (match[1]) {
      methods.push(match[1]);
    }
  }
  return methods;
}

/**
 * Check if a path matches any ignore pattern
 */
export function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
  
  return ignorePatterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    
    // Exact match or glob match
    if (minimatch(normalizedPath, normalizedPattern)) return true;
    
    // If it's a folder pattern, check if the path is inside it
    const folderPattern = normalizedPattern.endsWith('/') ? normalizedPattern : normalizedPattern + '/';
    if (normalizedPath.startsWith(folderPattern)) return true;
    
    return false;
  });
}

/**
 * Normalize API path for comparison
 * Removes trailing slashes, query params, dynamic segments for matching
 */
function normalizeApiPath(path: string): string {
  return path
    .replace(/\/$/, '') // Remove trailing slash
    .replace(/\?.*$/, '') // Remove query params
    .replace(/\$\{[^}]+\}/g, '*') // Replace template literals with wildcard
    .replace(/\[[^\]]+\]/g, '*') // Replace [param] with wildcard
    .toLowerCase();
}

/**
 * Check if a route is referenced by any of the found paths
 */
/**
 * Check if a route is referenced and which methods are used
 */
function checkRouteUsage(routePath: string, references: ApiReference[]): { used: boolean; usedMethods: Set<string> } {
  const normalizedRoute = normalizeApiPath(routePath);
  const usedMethods = new Set<string>();
  let used = false;

  for (const ref of references) {
    const normalizedFound = normalizeApiPath(ref.path);
    let match = false;

    // Exact match
    if (normalizedRoute === normalizedFound) match = true;
    // Route is prefix (dynamic)
    else if (normalizedFound.startsWith(normalizedRoute)) match = true;
    // Glob match
    else if (minimatch(normalizedFound, normalizedRoute)) match = true;

    if (match) {
      used = true;
      if (ref.method) {
        usedMethods.add(ref.method);
      } else {
        usedMethods.add('ALL');
      }
    }
  }

  return { used, usedMethods };
}

// ... (getVercelCronPaths)

/**
 * Load vercel.json and get cron paths
 */
function getVercelCronPaths(dir: string): string[] {
  const vercelPath = join(dir, 'vercel.json');

  if (!existsSync(vercelPath)) {
    return [];
  }

  try {
    const content = readFileSync(vercelPath, 'utf-8');
    const config: VercelConfig = JSON.parse(content);

    if (!config.crons) {
      return [];
    }

    return config.crons.map((cron) => cron.path);
  } catch {
    return [];
  }
}

export async function scan(config: Config): Promise<ScanResult> {
  const cwd = config.dir;

  // 1. Find all API route files
  const routePatterns = [
    'app/api/**/route.{ts,tsx,js,jsx}',
    'src/app/api/**/route.{ts,tsx,js,jsx}',
  ];

  const routeFiles = await fg(routePatterns, {
    cwd,
    ignore: config.ignore.folders,
  });

  const routes: ApiRoute[] = routeFiles.length > 0 
    ? routeFiles.map((file) => {
        const content = readFileSync(join(cwd, file), 'utf-8');
        const methods = extractExportedMethods(content);
        return {
          path: extractRoutePath(file),
          filePath: file,
          used: false,
          references: [],
          methods,
          unusedMethods: [...methods],
        };
      })
    : [];

  // 3. Mark vercel cron routes as used
  const cronPaths = getVercelCronPaths(cwd);
  for (const cronPath of cronPaths) {
    const route = routes.find((r) => r.path === cronPath);
    if (route) {
      route.used = true;
      route.references.push('vercel.json (cron)');
      route.unusedMethods = []; // Assume cron uses the route fully (usually GET)
    }
  }

  // 4. Find all source files to scan
  const extGlob = `**/*{${config.extensions.join(',')}}`;
  const sourceFiles = await fg(extGlob, {
    cwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  // 5. Collect all API references
  const allReferences: ApiReference[] = [];
  const fileReferences: Map<string, ApiReference[]> = new Map();

  for (const file of sourceFiles) {
    const filePath = join(cwd, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const refs = extractApiReferences(content);

      if (refs.length > 0) {
        fileReferences.set(file, refs);
        allReferences.push(...refs);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // 6. Mark routes as used
  for (const route of routes) {
    // Skip ignored routes
    if (shouldIgnore(route.path, config.ignore.routes)) {
      route.used = true;
      route.references.push('(ignored by config)');
      route.unusedMethods = [];
      continue;
    }

    // Check references
    const { used, usedMethods } = checkRouteUsage(route.path, allReferences);
    
    if (used) {
      route.used = true;
      
      // Update unused methods
      if (usedMethods.has('ALL')) {
        route.unusedMethods = [];
      } else {
        route.unusedMethods = route.methods.filter(m => !usedMethods.has(m));
      }

      // Find which files reference this route
      for (const [file, refs] of fileReferences) {
        if (checkRouteUsage(route.path, refs).used) {
          route.references.push(file);
        }
      }
    }
  }

  // 7. Scan public assets (if not excluded)
  let publicAssets;
  if (!config.excludePublic) {
    publicAssets = await scanPublicAssets(config);
  }

  // 8. Scan for unused files
  const unusedFiles = await scanUnusedFiles(config);

  return {
    total: routes.length,
    used: routes.filter((r) => r.used).length,
    unused: routes.filter((r) => !r.used).length,
    routes,
    publicAssets,
    unusedFiles,
    unusedExports: await scanUnusedExports(config),
  };
}
