import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './types.js';

export const DEFAULT_CONFIG: Config = {
  dir: './',
  ignore: {
    routes: [],
    folders: ['node_modules', '.next', 'dist', '.git', 'coverage', '.turbo'],
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
 */
export function loadConfig(options: CLIOptions): Config {
  const configPath = options.config || findConfigFile(options.dir || './');

  let fileConfig: Partial<Config> = {};

  if (configPath && existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content);
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Merge configs
  return {
    dir: options.dir || fileConfig.dir || DEFAULT_CONFIG.dir,
    ignore: {
      routes: [
        ...(DEFAULT_CONFIG.ignore.routes || []),
        ...(fileConfig.ignore?.routes || []),
      ],
      folders: [
        ...(DEFAULT_CONFIG.ignore.folders || []),
        ...(fileConfig.ignore?.folders || []),
      ],
      files: [
        ...(DEFAULT_CONFIG.ignore.files || []),
        ...(fileConfig.ignore?.files || []),
      ],
    },
    extensions: fileConfig.extensions || DEFAULT_CONFIG.extensions,
    excludePublic: options.excludePublic ?? fileConfig.excludePublic ?? false,
    nestGlobalPrefix: fileConfig.nestGlobalPrefix || DEFAULT_CONFIG.nestGlobalPrefix,
    extraRoutePatterns: fileConfig.extraRoutePatterns || DEFAULT_CONFIG.extraRoutePatterns,
  };
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
