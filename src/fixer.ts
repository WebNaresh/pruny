import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UnusedExport } from './types.js';

/**
 * Removes the 'export ' prefix from a specific line in a file,
 * OR deletes the entire declaration if it's dead code (not used internally)
 */
export function removeExportFromLine(rootDir: string, exp: UnusedExport): boolean {
  const fullPath = join(rootDir, exp.file);
  
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = exp.line - 1;

    // If not used internally, delete the entire declaration
    if (!exp.usedInternally) {
      const deletedLines = deleteDeclaration(lines, lineIndex);
      if (deletedLines > 0) {
        const newContent = lines.join('\n');
        
        // Check if file is now empty (only imports/whitespace left)
        if (isFileEmpty(newContent)) {
          unlinkSync(fullPath);
          return true;
        }
        
        writeFileSync(fullPath, newContent, 'utf-8');
        return true;
      }
      return false;
    }

    // If used internally, just remove the export keyword
    const originalLine = lines[lineIndex];
    const exportPrefixRegex = /^(export\s+(?:async\s+)?)/;
    
    if (exportPrefixRegex.test(originalLine.trim())) {
      const newLine = originalLine.replace(/(\s*)export\s+/, '$1');
      lines[lineIndex] = newLine;
      
      writeFileSync(fullPath, lines.join('\n'), 'utf-8');
      return true;
    }
    
    return false;
  } catch (err) {
    console.error(`Error fixing export in ${exp.file}:`, err);
    return false;
  }
}

/**
 * Delete an entire declaration starting from the given line
 * Returns the number of lines deleted
 */
function deleteDeclaration(lines: string[], startLine: number): number {
  if (startLine >= lines.length) return 0;

  let endLine = startLine;
  let braceCount = 0;
  let foundClosing = false;

  // Find the end of the declaration
  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    
    // Count braces to handle multi-line declarations
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    braceCount += openBraces - closeBraces;

    // Check for end of declaration
    if (braceCount === 0) {
      // For arrow functions and simple declarations
      if (line.includes(';') || line.includes('};')) {
        endLine = i;
        foundClosing = true;
        break;
      }
      // For function declarations without semicolons
      if (i > startLine && line.trim() === '}') {
        endLine = i;
        foundClosing = true;
        break;
      }
    }
  }

  if (!foundClosing && braceCount === 0) {
    // Single-line declaration
    endLine = startLine;
  }

  // Delete the lines
  const linesToDelete = endLine - startLine + 1;
  lines.splice(startLine, linesToDelete);
  
  return linesToDelete;
}

/**
 * Check if a file is effectively empty (only imports, whitespace, comments)
 */
function isFileEmpty(content: string): boolean {
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines
    if (!trimmed) continue;
    
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
    
    // Skip imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) continue;
    
    // Skip use client/server directives
    if (trimmed === '"use client";' || trimmed === '"use server";' || trimmed === "'use client';" || trimmed === "'use server';") continue;
    
    // If we found actual code, file is not empty
    return false;
  }
  
  // Only whitespace, comments, and imports
  return true;
}

/**
 * Removes a specific method from a route file
 */
export function removeMethodFromRoute(rootDir: string, filePath: string, methodName: string, lineNum: number): boolean {
  const fullPath = join(rootDir, filePath);
  
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = lineNum - 1;

    // Use deleteDeclaration to remove the function/decorator and its body
    const deletedLines = deleteDeclaration(lines, lineIndex);
    
    if (deletedLines > 0) {
      const newContent = lines.join('\n');
      
      // If file is now empty (e.g. all methods removed), delete it
      if (isFileEmpty(newContent)) {
        unlinkSync(fullPath);
      } else {
        writeFileSync(fullPath, newContent, 'utf-8');
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error removing method ${methodName} in ${filePath}:`, err);
    return false;
  }
}
