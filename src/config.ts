import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fg from 'fast-glob';
import type { Config, IgnoreConfig } from './types.js';

export const DEFAULT_CONFIG: Config = {
  dir: './',
  ignore: {
    routes: [],
    folders: ['node_modules', '.next', 'dist', '.git', 'coverage', '.turbo', 'build', 'out', '.cache', '.vercel', '.contentlayer', '.docusaurus', 'target', 'vendor'],
    files: [
      '*.test.ts',
      '*.spec.ts',
      '*.test.tsx',
      '*.spec.tsx',
      'public/robots.txt',
      'public/sitemap*.xml',
      'public/favicon.ico',
      'public/sw.js',
      'public/manifest.json',
      'public/twitter-image.*',
      'public/opengraph-image.*',
      'public/apple-icon.*',
      'public/icon.*',
      "proxy.*",
      "middleware.*"
    ],
  },
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  nestGlobalPrefix: 'api',
  extraRoutePatterns: [],
};

interface CLIOptions {
  dir?: string;
  config?: string;
  excludePublic?: boolean;
}

/**
 * Load config from file or use defaults
 * Recursively finds and merges all pruny.config.json files
 */
export function loadConfig(options: CLIOptions): Config {
  const cwd = options.dir || './';
  // 1. Find all config files
  const configFiles = fg.sync(['**/pruny.config.json', '**/.prunyrc.json', '**/.prunyrc'], {
    cwd,
    ignore: DEFAULT_CONFIG.ignore.folders,
    absolute: true,
  });
  
  // Prioritize CLI config if provided
  if (options.config && existsSync(options.config)) {
    const absConfig = resolve(cwd, options.config);
    if (!configFiles.includes(absConfig)) {
      configFiles.push(absConfig);
    }
  } else if (configFiles.length === 0) {
    // Try finding in root if nothing found by glob (fallback)
    const rootConfig = findConfigFile(cwd);
    if (rootConfig) configFiles.push(rootConfig);
  }

  // 2. Merge all found configs
  const mergedIgnore: IgnoreConfig = {
    routes: [...(DEFAULT_CONFIG.ignore.routes || [])],
    folders: [...(DEFAULT_CONFIG.ignore.folders || [])],
    files: [...(DEFAULT_CONFIG.ignore.files || [])],
  };
  
  let mergedExtensions = [...DEFAULT_CONFIG.extensions];
  let nestGlobalPrefix = DEFAULT_CONFIG.nestGlobalPrefix;
  let extraRoutePatterns = [...(DEFAULT_CONFIG.extraRoutePatterns || [])];
  let excludePublic = options.excludePublic ?? false;

  for (const configPath of configFiles) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      const config: Partial<Config> = JSON.parse(content);

      if (config.ignore?.routes) mergedIgnore.routes.push(...config.ignore.routes);
      if (config.ignore?.folders) mergedIgnore.folders.push(...config.ignore.folders);
      if (config.ignore?.files) mergedIgnore.files.push(...config.ignore.files);
      
      if (config.extensions) mergedExtensions = [...new Set([...mergedExtensions, ...config.extensions])];
      if (config.nestGlobalPrefix) nestGlobalPrefix = config.nestGlobalPrefix; // Last one wins or Root? Assume root is last scanned usually? unique issue.
      if (config.extraRoutePatterns) extraRoutePatterns.push(...config.extraRoutePatterns);
      if (config.excludePublic !== undefined) excludePublic = config.excludePublic;
      
      if (config.excludePublic !== undefined) excludePublic = config.excludePublic;
      
    } catch {
      // Ignore parse errors
    }
  }

  // 3. Load .gitignore from root
  const gitIgnorePatterns = parseGitIgnore(cwd);
  if (gitIgnorePatterns.length > 0) {
    // Add to folders as fast-glob uses this for ignore list
    mergedIgnore.folders.push(...gitIgnorePatterns);
  }

  // Deduplicate lists
  mergedIgnore.routes = [...new Set(mergedIgnore.routes)];
  mergedIgnore.folders = [...new Set(mergedIgnore.folders)];
  mergedIgnore.files = [...new Set(mergedIgnore.files)];

  return {
    dir: cwd,
    ignore: mergedIgnore,
    extensions: mergedExtensions,
    excludePublic,
    nestGlobalPrefix,
    extraRoutePatterns,
  };
}

/**
 * Parse .gitignore file
 */
function parseGitIgnore(dir: string): string[] {
  const gitIgnorePath = join(dir, '.gitignore');
  if (!existsSync(gitIgnorePath)) return [];

  try {
    const content = readFileSync(gitIgnorePath, 'utf-8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Find config file in directory
 */
function findConfigFile(dir: string): string | null {
  const candidates = ['pruny.config.json', '.prunyrc.json', '.prunyrc'];

  for (const name of candidates) {
    const path = join(dir, name);
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}
