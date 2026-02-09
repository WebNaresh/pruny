import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { UnusedExport } from './types.js';

/**
 * Removes the 'export ' prefix from a specific line in a file
 */
export function removeExportFromLine(rootDir: string, exp: UnusedExport): boolean {
  const fullPath = join(rootDir, exp.file);
  
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = exp.line - 1;
    const originalLine = lines[lineIndex];

    // Handle standard 'export const/function/etc'
    // Matches 'export ', 'export async ' etc.
    const exportPrefixRegex = /^(export\s+(?:async\s+)?)/;
    
    if (exportPrefixRegex.test(originalLine.trim())) {
      // We only remove the 'export ' part, preserving indentation
      const newLine = originalLine.replace(/(\s*)export\s+/, '$1');
      lines[lineIndex] = newLine;
      
      writeFileSync(fullPath, lines.join('\n'), 'utf-8');
      return true;
    }
    
    // Fallback for block exports or other complex cases: just comment it out?
    // For now, let's just handle the most common case to avoid breaking code.
    return false;
  } catch (err) {
    console.error(`Error fixing export in ${exp.file}:`, err);
    return false;
  }
}
