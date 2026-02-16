/**
 * Shared utility functions used across scanners, workers, and fixers.
 * Single source of truth — avoids duplication across modules.
 */

import { isAbsolute, join } from 'node:path';
import type { Config } from './types.js';

/**
 * Sanitize a line by removing string literals and comments for safe brace counting.
 * Handles escaped chars, single/double/template strings, single-line and inline block comments.
 */
export function sanitizeLine(line: string): string {
  return line
    .replace(/\\./g, '__')
    .replace(/'[^']*'/g, "''")
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\/\/.*/, '')
    .replace(/\/\*.*?\*\//g, '');
}

/**
 * Resolve a potentially relative file path to absolute using the config's root directory.
 */
export function resolveFilePath(filePath: string, config: Config): string {
  if (isAbsolute(filePath)) return filePath;
  const root = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
  return join(root, filePath);
}

/**
 * Extract the app/package name from a relative file path.
 * e.g., "apps/my-app/src/foo.ts" -> "apps/my-app"
 */
export function getAppName(filePath: string): string {
  if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
  if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
  return 'Root';
}

/**
 * Build a regex that checks if an export name appears in a code-like context.
 * Handles: function calls, property access, generics, type annotations, assignments, array types, etc.
 */
export function makeCodePattern(name: string): RegExp {
  const escaped = escapeRegExp(name);
  return new RegExp(
    `\\b${escaped}\\s*[({.,;<>|&\\[=)]` +
    `|\\b${escaped}\\s*\\)` +
    `|\\.[\\s\\n]*${escaped}\\b` +
    `|\\b${escaped}\\s*:[^:]` +
    `|:\\s*${escaped}\\b`
  );
}

/**
 * Escape special regex characters in a string.
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a path matches a filter pattern (case-insensitive).
 */
export function matchesFilter(path: string, filter: string): boolean {
  const lowerPath = path.toLowerCase();
  const appName = getAppName(path).toLowerCase();
  if (appName.includes(filter)) return true;
  const segments = lowerPath.split('/');
  for (const segment of segments) {
    if (segment === filter) return true;
    const withoutExt = segment.replace(/\.[^.]+$/, '');
    if (withoutExt === filter) return true;
  }
  return lowerPath.includes(filter);
}
