import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './types.js';

const DEFAULT_CONFIG: Config = {
  dir: './',
  ignore: {
    routes: [],
    folders: ['node_modules', '.next', 'dist', '.git', 'coverage', '.turbo'],
    files: ['*.test.ts', '*.spec.ts', '*.test.tsx', '*.spec.tsx'],
  },
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
};

interface CLIOptions {
  dir?: string;
  config?: string;
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
      routes: fileConfig.ignore?.routes || DEFAULT_CONFIG.ignore.routes,
      folders: fileConfig.ignore?.folders || DEFAULT_CONFIG.ignore.folders,
      files: fileConfig.ignore?.files || DEFAULT_CONFIG.ignore.files,
    },
    extensions: fileConfig.extensions || DEFAULT_CONFIG.extensions,
  };
}

/**
 * Find config file in directory
 */
function findConfigFile(dir: string): string | null {
  const candidates = ['zoink.config.json', '.zoinkrc.json', '.zoinkrc'];

  for (const name of candidates) {
    const path = join(dir, name);
    if (existsSync(path)) {
      return path;
    }
  }

  return null;
}
