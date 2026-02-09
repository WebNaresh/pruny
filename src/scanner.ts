import fg from 'fast-glob';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractApiPaths } from './patterns.js';
import type { Config, ApiRoute, ScanResult, VercelConfig } from './types.js';
import { minimatch } from 'minimatch';
import { scanPublicAssets } from './scanners/public-assets.js';

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

  return '/' + path;
}

/**
 * Check if a route matches any ignore pattern
 */
function shouldIgnoreRoute(routePath: string, ignorePatterns: string[]): boolean {
  return ignorePatterns.some((pattern) => minimatch(routePath, pattern));
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
    .toLowerCase();
}

/**
 * Check if a route is referenced by any of the found paths
 */
function isRouteReferenced(routePath: string, foundPaths: string[]): boolean {
  const normalizedRoute = normalizeApiPath(routePath);

  return foundPaths.some((foundPath) => {
    const normalizedFound = normalizeApiPath(foundPath);

    // Exact match
    if (normalizedRoute === normalizedFound) return true;

    // Route is prefix of found path (for dynamic routes)
    if (normalizedFound.startsWith(normalizedRoute)) return true;

    // Found path matches route pattern
    if (minimatch(normalizedFound, normalizedRoute)) return true;

    return false;
  });
}

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

/**
 * Scan for unused API routes
 */
export async function scan(config: Config): Promise<ScanResult> {
  // console.log('DEBUG: scan() called with config:', JSON.stringify(config, null, 2));
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
    ? routeFiles.map((file) => ({
        path: extractRoutePath(file),
        filePath: file,
        used: false,
        references: [],
      }))
    : [];

  // 3. Mark vercel cron routes as used
  const cronPaths = getVercelCronPaths(cwd);
  for (const cronPath of cronPaths) {
    const route = routes.find((r) => r.path === cronPath);
    if (route) {
      route.used = true;
      route.references.push('vercel.json (cron)');
    }
  }

  // 4. Find all source files to scan
  const extGlob = `**/*{${config.extensions.join(',')}}`;
  const sourceFiles = await fg(extGlob, {
    cwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  // 5. Collect all API paths referenced in codebase
  const allReferencedPaths: Set<string> = new Set();
  const fileReferences: Map<string, string[]> = new Map();

  for (const file of sourceFiles) {
    const filePath = join(cwd, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const paths = extractApiPaths(content);

      if (paths.length > 0) {
        fileReferences.set(file, paths);
        paths.forEach((p) => allReferencedPaths.add(p));
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // 6. Mark routes as used if referenced
  const referencedArray = Array.from(allReferencedPaths);

  for (const route of routes) {
    // Skip ignored routes
    if (shouldIgnoreRoute(route.path, config.ignore.routes)) {
      route.used = true;
      route.references.push('(ignored by config)');
      continue;
    }

    // Check if already marked (e.g., by vercel cron)
    if (route.used) continue;

    // Check references
    if (isRouteReferenced(route.path, referencedArray)) {
      route.used = true;

      // Find which files reference this route
      for (const [file, paths] of fileReferences) {
        if (paths.some((p) => isRouteReferenced(route.path, [p]))) {
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

  return {
    total: routes.length,
    used: routes.filter((r) => r.used).length,
    unused: routes.filter((r) => !r.used).length,
    routes,
    publicAssets,
  };
}
