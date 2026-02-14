import fg from 'fast-glob';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { join } from 'node:path';
import {
  extractApiReferences,
  EXPORTED_METHOD_PATTERN,
  NEST_CONTROLLER_PATTERN,
  NEST_METHOD_PATTERN,
  type ApiReference
} from './patterns.js';
import type { Config, ApiRoute, ScanResult, VercelConfig } from './types.js';
import { minimatch } from 'minimatch';
import { scanPublicAssets } from './scanners/public-assets.js';
import { scanUnusedFiles } from './scanners/unused-files.js';
import { scanUnusedExports } from './scanners/unused-exports.js';
import { scanHttpUsage } from './scanners/http-usage.js';
import { scanSourceAssets } from './scanners/source-assets.js';
import { scanMissingAssets } from './scanners/missing-assets.js';

export { scanUnusedExports, scanUnusedFiles, scanHttpUsage, scanSourceAssets, scanMissingAssets };

/**
 * Extract route path from file path
 * Supports:
 * - Single Repo: app/api/users/route.ts -> /api/users
 * - Monorepo: apps/web/app/api/users/route.ts -> /api/users (normalized)
 */
function extractRoutePath(filePath: string): string {
  // 1. Remove standard prefixes
  let path = filePath
    .replace(/^src\//, '')
    .replace(/^apps\/[^/]+\//, '') // Remove apps/<app-name>/
    .replace(/^packages\/[^/]+\//, ''); // Remove packages/<pkg-name>/

  // 2. Remove app/ prefix
  path = path.replace(/^app\//, '');

  // 3. Remove route suffix
  path = path.replace(/\/route\.(ts|tsx|js|jsx)$/, '');

  return '/' + path;
}

/**
 * Extract Next.js exported HTTP methods and their line numbers
 */
function extractExportedMethods(content: string): { methods: string[]; methodLines: { [method: string]: number } } {
  const methods: string[] = [];
  const methodLines: { [method: string]: number } = {};
  const lines = content.split('\n');
  
  let match;
  EXPORTED_METHOD_PATTERN.lastIndex = 0;
  while ((match = EXPORTED_METHOD_PATTERN.exec(content)) !== null) {
    if (match[1]) {
      const methodName = match[1];
      methods.push(methodName);
      
      // Calculate line number
      const pos = match.index;
      const lineNum = content.substring(0, pos).split('\n').length;
      methodLines[methodName] = lineNum;
    }
  }
  return { methods, methodLines };
}

/**
 * Extract NestJS Controller Routes
 */
function extractNestRoutes(filePath: string, content: string, globalPrefix = 'api'): ApiRoute[] {
  // 1. Find Controller Decorator
  const controllerMatch = content.match(NEST_CONTROLLER_PATTERN);
  if (!controllerMatch) return [];

  const controllerPath = controllerMatch[1] || ''; // Empty string if @Controller()
  const routes: ApiRoute[] = [];

  // 2. Find Method Decorators
  NEST_METHOD_PATTERN.lastIndex = 0;
  let methodMatch;
  while ((methodMatch = NEST_METHOD_PATTERN.exec(content)) !== null) {
    // methodMatch[1] = 'Get', 'Post', etc.
    // methodMatch[2] = 'profile' (path)
    const methodType = methodMatch[1].toUpperCase();
    const methodPath = methodMatch[2] || '';
    
    // Calculate line number for NestJS methods too
    const pos = methodMatch.index;
    const lineNum = content.substring(0, pos).split('\n').length;

    // Construct full path: /<globalPrefix>/<controller>/<method>
    const fullPath = `/${globalPrefix}/${controllerPath}/${methodPath}`
      .replace(/\/+/g, '/') // Dedupe slashes
      .replace(/\/$/, '');  // Remove trailing slash

    // Check if route already exists for this path (handled different methods on same path)
    const existing = routes.find(r => r.path === fullPath);
    if (existing) {
      if (!existing.methods.includes(methodType)) {
        existing.methods.push(methodType);
        existing.unusedMethods.push(methodType);
        existing.methodLines[methodType] = lineNum;
      }
    } else {
      routes.push({
        type: 'nestjs',
        path: fullPath,
        filePath,
        used: false,
        references: [],
        methods: [methodType],
        unusedMethods: [methodType],
        methodLines: { [methodType]: lineNum },
      });
    }

    if (process.env.DEBUG_PRUNY) {
      console.log(`[DEBUG] Extracted Route: ${fullPath} from ${filePath}`);
    }
  }

  return routes;
}

/**
 * Check if a path matches any ignore pattern
 */
export function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const cleanPath = path.replace(/\\/g, '/').replace(/^\//, '').replace(/^\.\//, '');

  return ignorePatterns.some((pattern) => {
    let cleanPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
    const isAbsolute = cleanPattern.startsWith('/');
    if (isAbsolute) cleanPattern = cleanPattern.substring(1);

    // 1. Exact or glob match
    if (minimatch(cleanPath, cleanPattern)) return true;

    // 2. Folder check
    const folderPattern = cleanPattern.endsWith('/') ? cleanPattern : cleanPattern + '/';
    if (cleanPath.startsWith(folderPattern)) return true;

    // 3. Suffix match for simple segments (tags)
    if (!isAbsolute && !cleanPattern.includes('/') && !cleanPattern.includes('*')) {
      if (cleanPath.endsWith('/' + cleanPattern) || cleanPath === cleanPattern) return true;
    }

    return false;
  });
}

/**
 * Normalize Next.js API path for comparison (e.g. /api/users/[id] -> /api/users/*)
 */
function normalizeNextPath(path: string): string {
  return path
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/\[[^\]]+\]/g, '*')
    .toLowerCase();
}

/**
 * Normalize NestJS API path for comparison (e.g. /api/users/:id -> /api/users/*)
 */
function normalizeNestPath(path: string): string {
  return path
    .replace(/\/$/, '')
    .replace(/\?.*$/, '')
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/:[^/]+/g, '*')
    .toLowerCase();
}

/**
 * Check if a route is referenced and which methods are used
 */
function checkRouteUsage(route: ApiRoute, references: ApiReference[], nestGlobalPrefix = ''): { used: boolean; usedMethods: Set<string> } {
  const normalize = route.type === 'nextjs' ? normalizeNextPath : normalizeNestPath;
  const normalizedRoute = normalize(route.path);
  
  // Potential variations of the route path for matching
  const variations = new Set<string>([normalizedRoute]);

  if (route.type === 'nestjs') {
    // 1. If it has a prefix, try without it
    if (nestGlobalPrefix) {
      const prefixToRemove = `/${nestGlobalPrefix}`.replace(/\/+/g, '/');
      if (route.path.startsWith(prefixToRemove)) {
        variations.add(normalize(route.path.substring(prefixToRemove.length)));
      }
    }
    
    // 2. Try adding/removing /api explicitly as it's the most common convention
    if (route.path.startsWith('/api/')) {
      variations.add(normalize(route.path.substring(4)));
    } else {
      variations.add(normalize('/api' + route.path));
    }
  }

  const usedMethods = new Set<string>();
  let used = false;

  for (const ref of references) {
    let normalizedFound = ref.path
      .replace(/\s+/g, '') // Collapse all whitespace (newlines, tabs, spaces from multiline template literals)
      .replace(/\/$/, '')
      .replace(/\?.*$/, '')
      .replace(/\$\{[^}]+\}/g, '*')
      .toLowerCase();
    
    // If it starts with *, it likely had a base URL variable: `${baseUrl}/api/...` -> `*/api/...`
    // We want to match against the static part, so we can try stripping the leading *
    if (normalizedFound.startsWith('*')) {
      const firstSlash = normalizedFound.indexOf('/');
      if (firstSlash !== -1) {
        normalizedFound = normalizedFound.substring(firstSlash);
      }
    }

    let match = false;
    for (const v of variations) {
      if (v === normalizedFound || 
          normalizedFound.startsWith(v + '/') ||
          minimatch(normalizedFound, v)) {
        match = true;
        break;
      }
    }

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

    return config.crons.map((cron: { path: string }) => cron.path);
  } catch {
    return [];
  }
}

export async function scan(config: Config): Promise<ScanResult> {
  const cwd = config.dir;

  // 1. Find Next.js Routes
  const nextPatterns = [
    // Standard patterns
    'app/api/**/route.{ts,tsx,js,jsx}',
    'src/app/api/**/route.{ts,tsx,js,jsx}',
    'apps/**/app/api/**/route.{ts,tsx,js,jsx}',
    'packages/**/app/api/**/route.{ts,tsx,js,jsx}',
  ];

  // If appSpecificScan is set, OVERRIDE patterns to only look inside that app
  let scanCwd = cwd;
  let activeNextPatterns = nextPatterns;

  if (config.appSpecificScan) {
      scanCwd = config.appSpecificScan.appDir;
      activeNextPatterns = [
          'app/api/**/route.{ts,tsx,js,jsx}',
          'src/app/api/**/route.{ts,tsx,js,jsx}',
      ];
  }

  // Add extra patterns from config
  if (config.extraRoutePatterns) {
    activeNextPatterns.push(...config.extraRoutePatterns);
  }

  const nextFiles = await fg(activeNextPatterns, {
    cwd: scanCwd,
    ignore: config.ignore.folders,
  });

  const nextRoutes: ApiRoute[] = nextFiles.map((file) => {
    // If scanning in appDir specific context, we need to map back relative to root if needed, 
    // but here we just need a unique path identification.
    // The existing extractRoutePath handles simple relative paths well.
    const fullPath = join(scanCwd, file);
    const content = readFileSync(fullPath, 'utf-8');
    const { methods, methodLines } = extractExportedMethods(content);
    return {
      type: 'nextjs',
      path: extractRoutePath(file), // This extracts /api/xyz
      filePath: fullPath.replace(config.appSpecificScan ? config.appSpecificScan.rootDir + '/' : cwd + '/', ''), // Store relative path from ROOT
      used: false,
      references: [],
      methods,
      unusedMethods: [...methods],
      methodLines,
    };
  });

  // 2. Find NestJS Controllers
  const nestPatterns = ['**/*.controller.ts'];
  const nestFiles = await fg(nestPatterns, {
    cwd: scanCwd, // Use the context-aware CWD
    ignore: config.ignore.folders,
  });

  const nestRoutes: ApiRoute[] = nestFiles.flatMap((file) => {
    const fullPath = join(scanCwd, file);
    const content = readFileSync(fullPath, 'utf-8');
    const relativePathFromRoot = fullPath.replace(config.appSpecificScan ? config.appSpecificScan.rootDir + '/' : cwd + '/', '');
    
    // When inside a specific app scan, we might want to respect that app's prefix if we could detect it,
    // but for now we rely on the global config prefix.
    return extractNestRoutes(relativePathFromRoot, content, config.nestGlobalPrefix);
  });

  // Combine Routes
  const routes = [...nextRoutes, ...nestRoutes];

  // 3. Mark vercel cron routes as used
  const cronPaths = getVercelCronPaths(cwd);
  for (const cronPath of cronPaths) {
    const route = routes.find((r) => r.path === cronPath);
    if (route) {
      if (route.path.includes('month_wise_revenue_sort')) {
         console.log(`[SCANNER TRACE] Route marked USED by Vercel Cron: ${route.path}`);
      }
      route.used = true;
      route.references.push('vercel.json (cron)');
      route.unusedMethods = [];
    }
  }

  // 4. Find all source files to scan (ALWAYS SCAN ROOT FOR REFERENCES)
  // Even if we are scanning just one app's routes, we must check if other apps/packages call them.
  const referenceScanCwd = config.appSpecificScan ? config.appSpecificScan.rootDir : cwd;
  
  const extGlob = `**/*{${config.extensions.join(',')}}`;
  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG] Glob Pattern: ${extGlob}`);
  }
  const sourceFiles = await fg(extGlob, {
    cwd: referenceScanCwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG] Reference Scan CWD: ${referenceScanCwd}`);
    console.log(`[DEBUG] Source Files Found: ${sourceFiles.length}`);
    if (sourceFiles.length > 0) {
      console.log(`[DEBUG] First 5 files: ${sourceFiles.slice(0, 5).join(', ')}`);
      const hasWeb = sourceFiles.some(f => f.includes('abhyasika-web'));
      console.log(`[DEBUG] Includes abhyasika-web?: ${hasWeb}`);
    }
  }

  // 5. Collect all API references
  const allReferences: ApiReference[] = [];
  const fileReferences: Map<string, ApiReference[]> = new Map();

  for (const file of sourceFiles) {
    const filePath = join(referenceScanCwd, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const refs = extractApiReferences(content);

      if (refs.length > 0) {
        // file is relative to referenceScanCwd (Root)
        fileReferences.set(file, refs);
        allReferences.push(...refs);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // 6. Mark routes as used
  for (const route of routes) {
    // Skip ignored routes (check both API path and source file path)
    if (shouldIgnore(route.path, config.ignore.routes) || shouldIgnore(route.filePath, config.ignore.routes)) {
      if (route.path.includes('month_wise_revenue_sort')) {
         console.log(`[SCANNER TRACE] Route IGNORED by config: ${route.path}`);
      }
      route.used = true;
      route.references.push('(ignored by config)');
      route.unusedMethods = [];
      continue;
    }

    // Check references
    const { used, usedMethods } = checkRouteUsage(route, allReferences, config.nestGlobalPrefix);

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
        if (checkRouteUsage(route, refs, config.nestGlobalPrefix).used) {
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

  const targetRoute = routes.find(r => r.path.includes('month_wise_revenue_sort'));
  if (targetRoute) {
      console.log(`[SCANNER FINAL] Route ${targetRoute.path}`);
      console.log(`[SCANNER FINAL] Used: ${targetRoute.used}`);
      console.log(`[SCANNER FINAL] Unused Methods: ${targetRoute.unusedMethods.join(', ')}`);
      console.log(`[SCANNER FINAL] References: ${targetRoute.references.join(', ')}`);
  }

  return {
    total: routes.length,
    used: routes.filter((r) => r.used).length,
    unused: routes.filter((r) => !r.used).length,
    routes,
    publicAssets,
    missingAssets: await scanMissingAssets(config),
    unusedFiles,
    unusedExports: await scanUnusedExports(config, routes),
    httpUsage: await scanHttpUsage(config),
  };
}
