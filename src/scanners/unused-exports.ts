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
  console.log(`📝 Scanning ${allFiles.length} files for exports...`);
  let processedFiles = 0;
  
  for (const file of allFiles) {
    try {
      processedFiles++;
      
      // Show progress every 10 files (more frequent updates)
      if (processedFiles % 10 === 0 || processedFiles === allFiles.length) {
        const percent = Math.round((processedFiles / allFiles.length) * 100);
        const shortFile = file.length > 50 ? '...' + file.slice(-47) : file;
        process.stdout.write(`\r   Progress: ${processedFiles}/${allFiles.length} (${percent}%) - ${shortFile}${' '.repeat(10)}`);
      }
      
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
  
  // Clear progress line
  if (processedFiles > 0) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
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
  
  console.log(`🔍 Checking usage of ${allExportsCount} exports...`);

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
          const trimmed = line.trim();
          
          // Skip obvious non-code lines
          if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
          
          // Check for actual usage with code-like context
          const referenceRegex = new RegExp(`\\b${exp.name}\\b`);
          if (referenceRegex.test(line)) {
            // Verify it's in code context (not just a word in a comment/string)
            const codePattern = new RegExp(`\\b${exp.name}\\s*[({.,;)]|\\b${exp.name}\\s*\\)|\\s+${exp.name}\\b`);
            if (codePattern.test(line)) {
              usedInternally = true;
              break;
            }
          }
        }
      }

      // Then check external usage (in other files)
      for (const [otherFile, content] of totalContents.entries()) {
        if (file === otherFile) continue;

        // Fast path: Check for common usage patterns first (most performant)
        // JSX usage: <ExportName
        const jsxPattern = new RegExp(`<${exp.name}[\\s/>]`);
        if (jsxPattern.test(content)) {
          isUsed = true;
          break;
        }
        
        // Import usage: import { ExportName } from
        const importPattern = new RegExp(`import.*\\b${exp.name}\\b.*from`);
        if (importPattern.test(content)) {
          isUsed = true;
          break;
        }
        
        // For other potential usage, use word boundary check but exclude obvious false positives
        const wordBoundaryPattern = new RegExp(`\\b${exp.name}\\b`);
        if (wordBoundaryPattern.test(content)) {
          // Found potential match - verify it's in actual code, not strings/comments
          const lines = content.split('\n');
          let inMultilineComment = false;
          let inTemplateLiteral = false;
          
          for (const line of lines) {
            const trimmed = line.trim();
            
            // Track multi-line comment state
            if (trimmed.includes('/*')) inMultilineComment = true;
            if (trimmed.includes('*/')) {
              inMultilineComment = false;
              continue;
            }
            if (inMultilineComment) continue;
            
            // Track template literal state (multi-line strings with backticks)
            // Count backticks to toggle template literal state
            const backtickCount = (line.match(/`/g) || []).length;
            if (backtickCount % 2 !== 0) {
              inTemplateLiteral = !inTemplateLiteral;
            }
            
            // Skip if we're inside a template literal
            if (inTemplateLiteral) continue;
            
            // Skip single-line comments
            if (trimmed.startsWith('//')) continue;
            
            // Skip JSX comments
            if (trimmed.includes('{/*') || trimmed.includes('*/}')) continue;
            
            // Simple check: if line contains the export name AND looks like code
            // (has code-like patterns: function calls, property access, etc.)
            if (wordBoundaryPattern.test(line)) {
              const codePattern = new RegExp(`\\b${exp.name}\\s*[({.,;)]|\\b${exp.name}\\s*\\)|\\s+${exp.name}\\b`);
              if (codePattern.test(line)) {
                isUsed = true;
                break;
              }
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
