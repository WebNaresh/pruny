import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, UnusedExport } from '../types.js';

// Next.js/React standard exports that shouldn't be marked as unused
const IGNORED_EXPORT_NAMES = new Set([
  'config',
  'generateMetadata',
  'generateStaticParams',
  'dynamic',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'metadata',
  'viewport',
  'dynamicParams',
  'maxDuration',
  'generateViewport',
  'generateSitemaps',
  'generateImageMetadata',
  'alt',
  'size',
  'contentType',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', // Handled by API scanner
  'default'
]);

/**
 * Scan for unused named exports within source files
 */
export async function scanUnusedExports(config: Config): Promise<{ total: number; used: number; unused: number; exports: UnusedExport[] }> {
  const cwd = config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  // 1. Find all potential source files
  const allFiles = await fg(extGlob, {
    cwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
  });

  if (allFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, exports: [] };
  }

  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const totalContents = new Map<string, string>();
  let allExportsCount = 0;

  // Patterns to find exports
  const inlineExportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|type|interface|enum|class)\s+([a-zA-Z0-9_$]+)/gm;
  const blockExportRegex = /^export\s*\{([^}]+)\}/gm;

  // 2. Extract all exports
  for (const file of allFiles) {
    try {
      const content = readFileSync(join(cwd, file), 'utf-8');
      totalContents.set(file, content);

      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        inlineExportRegex.lastIndex = 0;
        let match;
        while ((match = inlineExportRegex.exec(line)) !== null) {
          if (addExport(file, match[1], i + 1)) {
            allExportsCount++;
          }
        }

        blockExportRegex.lastIndex = 0;
        while ((match = blockExportRegex.exec(line)) !== null) {
          const names = match[1].split(',').map(n => {
             const parts = n.trim().split(/\s+as\s+/);
             return parts[parts.length - 1];
          });
          for (const name of names) {
            if (addExport(file, name, i + 1)) {
              allExportsCount++;
            }
          }
        }
      }
    } catch {
      // Skip unreadable
    }
  }

  function addExport(file: string, name: string, line: number): boolean {
    if (name && !IGNORED_EXPORT_NAMES.has(name)) {
      if (!exportMap.has(file)) exportMap.set(file, []);
      exportMap.get(file)!.push({ name, line, file });
      return true;
    }
    return false;
  }

  const unusedExports: UnusedExport[] = [];

  // 3. Check for references in all files
  for (const [file, exports] of exportMap.entries()) {
    for (const exp of exports) {
      let isUsed = false;
      let usedInternally = false;

      // First check internal usage (within the same file)
      const fileContent = totalContents.get(file);
      if (fileContent) {
        const lines = fileContent.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i === exp.line - 1) continue; // Skip the declaration line
          
          const line = lines[i];
          if (isCommentOrString(line)) continue; // Skip full-line comments
          
          // Strip strings and check for reference
          const cleanLine = stripStringsAndComments(line);
          const referenceRegex = new RegExp(`\\b${exp.name}\\b`);
          if (referenceRegex.test(cleanLine)) {
            usedInternally = true;
            break;
          }
        }
      }

      // Then check external usage (in other files)
      for (const [otherFile, content] of totalContents.entries()) {
        if (file === otherFile) continue;

        // Check if export is used in actual code (not just in strings/comments)
        // Look for JSX usage: <ExportName or import patterns
        const jsxPattern = new RegExp(`<${exp.name}[\\s/>]`);
        const importPattern = new RegExp(`import.*\\b${exp.name}\\b.*from`);
        const destructurePattern = new RegExp(`\\{[^}]*\\b${exp.name}\\b[^}]*\\}`);
        
        if (jsxPattern.test(content) || importPattern.test(content)) {
          isUsed = true;
          break;
        }
        
        // For non-component exports, check each line with string stripping
        if (!isUsed) {
          const lines = content.split('\n');
          for (const line of lines) {
            if (isCommentOrString(line)) continue;
            
            // Strip strings and check for reference in code context
            const cleanLine = stripStringsAndComments(line);
            
            // Check if it's actual code usage (not just the word appearing)
            // Must be followed by ( for function calls, or proper identifier usage
            const codeUsagePattern = new RegExp(`\\b${exp.name}\\s*[({]|\\b${exp.name}\\s*\\.|\\b${exp.name}\\s*,|\\b${exp.name}\\s*;|\\b${exp.name}\\s*\\)`);
            if (codeUsagePattern.test(cleanLine)) {
              isUsed = true;
              break;
            }
          }
        }
        
        if (isUsed) break;
      }

      if (!isUsed) {
        unusedExports.push({ ...exp, usedInternally });
      }
    }
  }

  return {
    total: allExportsCount,
    used: allExportsCount - unusedExports.length,
    unused: unusedExports.length,
    exports: unusedExports
  };
}

/**
 * Check if a line is a comment or within a string literal
 */
function isCommentOrString(line: string): boolean {
  const trimmed = line.trim();
  
  // Single-line comments
  if (trimmed.startsWith('//')) return true;
  
  // Multi-line comment start
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  
  // JSX/HTML comments
  if (trimmed.includes('{/*') || trimmed.includes('*/}')) return true;
  
  return false;
}

/**
 * Remove string literals and comments from a line before checking for export usage
 */
function stripStringsAndComments(line: string): string {
  let result = line;
  
  // Remove single-line comments
  result = result.replace(/\/\/.*$/g, '');
  
  // Remove string literals (both single and double quotes)
  // Handles escaped quotes and template literals
  result = result.replace(/'([^'\\]|\\.)*'/g, "''"); // Single quotes
  result = result.replace(/"([^"\\]|\\.)*"/g, '""'); // Double quotes
  result = result.replace(/`([^`\\]|\\.)*`/g, '``'); // Template literals
  
  return result;
}
