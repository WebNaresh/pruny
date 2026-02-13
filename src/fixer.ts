import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UnusedExport } from './types.js';

/**
 * Removes the 'export ' prefix from a specific line in a file,
 * OR deletes the entire declaration if it's dead code (not used internally)
 */
export function removeExportFromLine(rootDir: string, exp: UnusedExport): boolean {
  const fullPath = join(rootDir, exp.file);
  if (!existsSync(fullPath)) return false;
  
  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const lineIndex = findDeclarationIndex(lines, exp.name, exp.line - 1);

    if (!exp.usedInternally) {
      const trueStartLine = findDeclarationStart(lines, lineIndex);
      const deletedLines = deleteDeclaration(lines, trueStartLine, exp.name);
      
      if (deletedLines > 0) {
        const newContent = lines.join('\n');
        if (isFileEmpty(newContent)) {
          unlinkSync(fullPath);
        } else {
          writeFileSync(fullPath, newContent, 'utf-8');
        }
        return true;
      }
      return false;
    }

    const originalLine = lines[lineIndex];
    if (originalLine.trim().startsWith('export ')) {
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
 * Find the actual line index for a declaration, handling shifts
 */
function findDeclarationIndex(lines: string[], name: string, hintIndex: number): number {
  let searchName = name;
  
  // If name is an HTTP verb (GET, POST, etc.), convert to NestJS decorator format (@Get, @Post)
  // This is because scanner extracts 'GET' but code has '@Get'
  if (/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|ALL)$/.test(name)) {
    searchName = '@' + name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Safe check for hintIndex
  if (hintIndex >= 0 && hintIndex < lines.length && lines[hintIndex] && lines[hintIndex].includes(searchName)) {
    return hintIndex;
  }
  
  for (let i = 1; i < 50; i++) {
    // Check backwards
    const prev = hintIndex - i;
    if (prev >= 0 && prev < lines.length && lines[prev] && lines[prev].includes(searchName)) {
      return prev;
    }
    
    // Check forwards
    const next = hintIndex + i;
    if (next >= 0 && next < lines.length && lines[next] && lines[next].includes(searchName)) {
      return next;
    }
  }
  
  return lines.findIndex(l => l && l.includes(searchName));
}

/**
 * Find the true start of a declaration, including preceding decorators
 */
function findDeclarationStart(lines: string[], lineIndex: number): number {
  let current = lineIndex;
  
  while (current > 0) {
    const prevLine = lines[current - 1].trim();
    
    // Check for direct decorators or comments
    if (prevLine.startsWith('@') || prevLine.startsWith('//') || prevLine.startsWith('/*')) {
      current--;
    } 
    // Check for empty lines, but only if they are preceded by a decorator
    else if (prevLine === '') {
      let foundDecoratorAbove = false;
      // Look up a few lines to see if there's a decorator pending
      for (let k = 1; k <= 3; k++) {
        if (current - 1 - k >= 0) {
          const checkLine = lines[current - 1 - k].trim();
          if (checkLine.startsWith('@')) {
            foundDecoratorAbove = true;
            break;
          }
          if (checkLine !== '') break; // Stop if we hit code
        }
      }
      if (foundDecoratorAbove) {
        current--;
      } else {
        break;
      }
    } 
    // Check for multi-line decorators ending with ), }, or },
    else if (prevLine.endsWith(')') || prevLine.endsWith('}') || prevLine.endsWith('},')) {
       let foundDecorator = false;
       // Scan upwards to find the start of this potential decorator
       for (let j = current - 1; j >= Math.max(0, current - 20); j--) {
         if (lines[j].trim().startsWith('@')) {
           current = j; // Move current to the start of this decorator
           foundDecorator = true;
           break;
         }
       }
       if (!foundDecorator) break;
    } else {
      break;
    }
  }
  
  return current;
}

/**
 * Delete an entire declaration starting from the given line
 */
function deleteDeclaration(lines: string[], startLine: number, name: string | null): number {
  if (startLine >= lines.length) return 0;

  let endLine = startLine;
  let braceCount = 0;
  let foundMethodDefinition = false;
  let foundBodyOpening = false;
  let foundClosing = false;
  
  // Regex to identify the actual method/class/function definition line
  // Excludes lines starting with @ (decorators) or comments
  const methodDefRegex = /^(?:export\s+)?(?:public|private|protected|static|async|readonly|\s)*[a-zA-Z0-9_$]+\s*[=(<]/;
  const methodDefRegexSimple = /^[a-zA-Z0-9_$]+\s*\(/; 

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Check for comment or empty line
    const isCommentOrEmpty = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed === '';
    const isDecorator = trimmed.startsWith('@');

    // 1. Identify where the actual method definition starts (skipping decorators)
    if (!foundMethodDefinition && !isDecorator && !isCommentOrEmpty && braceCount === 0) {
       // Check if it looks like a method definition
       if (methodDefRegex.test(trimmed) || methodDefRegexSimple.test(trimmed) || (name && (trimmed.includes(` ${name}(`) || trimmed.startsWith(`${name}(`)))) {
          foundMethodDefinition = true;
       }
    }

    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    
    // 2. Track braces ONLY after we found the method definition
    if (foundMethodDefinition) {
        braceCount += openBraces - closeBraces;
        
        if (!foundBodyOpening && openBraces > 0) {
            foundBodyOpening = true;
        }
        
        if (foundBodyOpening && braceCount <= 0) {
            endLine = i;
            foundClosing = true;
            break;
        }
        
        // Fallback: if we haven't found a body opening yet but see a semicolon, it might be an abstract method or one-liner
        if (!foundBodyOpening && trimmed.endsWith(';') && braceCount === 0) {
             endLine = i;
             foundClosing = true;
             break;
        }
    } else {
        // We are still in decorators/comments section.
        // Safety check: stop if we search too far without finding a method definition
        if (i > startLine + 50) { 
            break; 
        }
    }
  }

  if (foundClosing) {
      const linesToDelete = endLine - startLine + 1;
      lines.splice(startLine, linesToDelete);
      return linesToDelete;
  }
  
  return 0;
}

/**
 * Check if a file is effectively empty
 */
function isFileEmpty(content: string): boolean {
  return content.split('\n').every(line => {
    const t = line.trim();
    if (!t) return true;
    if (t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) return true;
    if (t.startsWith('import ')) return true;
    if (t === '"use client";' || t === '"use server";' || t === "'use client';" || t === "'use server';") return true;
    
    // Only safely ignore re-exports or type exports if we want to be strict
    // But honestly, if there is ANY export left, the file is likely NOT empty.
    // The previous logic `t.startsWith('export ')` was too aggressive.
    // We should only consider it empty if it's strictly empty of runtime code.
    // If it has `export class`, `export function`, `export const`, it is NOT empty.
    
    // We might want to ignore `export type` or `export interface` if we only care about runtime?
    // But pruny is about cleaning dead code. If a type is exported, it might be used.
    // So we should probably ONLY ignore `export` if we are sure it's not a declaration we care about?
    // Actually, safest is: if there is ANY `export` statement that we didn't delete, the file is NOT empty.
    // The only exception might be `export {};` (empty export)
    
    return false;
  });
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
    
    // 1. Find the target line index (handle shifts)
    const targetIndex = findDeclarationIndex(lines, methodName, lineNum - 1);
    if (targetIndex === -1) return false;

    // 2. Find the true start (including decorators)
    const trueStartLine = findDeclarationStart(lines, targetIndex);

    // 3. Delete the block
    const deletedLines = deleteDeclaration(lines, trueStartLine, methodName);
    
    if (deletedLines > 0) {
      const newContent = lines.join('\n');
      if (isFileEmpty(newContent)) unlinkSync(fullPath);
      else writeFileSync(fullPath, newContent, 'utf-8');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error removing method ${methodName} in ${filePath}:`, err);
    return false;
  }
}
