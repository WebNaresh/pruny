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
  if (/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|ALL)$/.test(name)) {
    searchName = '@' + name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  }

  // Use word boundaries for exact matching to avoid matching part of a word.
  // CRITICAL: We can't use \b before @ because @ is a non-word character.
  const regex = searchName.startsWith('@') 
    ? new RegExp(`${searchName}\\b`) 
    : new RegExp(`\\b${searchName}\\b`);

  // 1. Try exact hint first
  if (hintIndex >= 0 && hintIndex < lines.length && lines[hintIndex] && regex.test(lines[hintIndex])) {
    return hintIndex;
  }
  
  // 2. Search nearby
  for (let i = 1; i < 50; i++) {
    const prev = hintIndex - i;
    if (prev >= 0 && prev < lines.length && lines[prev] && regex.test(lines[prev])) {
      return prev;
    }
    
    const next = hintIndex + i;
    if (next >= 0 && next < lines.length && lines[next] && regex.test(lines[next])) {
      return next;
    }
  }
  
  // 3. Fallback to whole file
  return lines.findIndex(l => l && regex.test(l));
}

/**
 * Find the true start of a declaration, including preceding decorators
 */
function findDeclarationStart(lines: string[], lineIndex: number): number {
  let current = lineIndex;
  
  while (current > 0) {
    const prevLine = lines[current - 1].trim();
    
    // Check for direct decorators or comments (including JSDoc)
    if (prevLine.startsWith('@') || prevLine.startsWith('//') || prevLine.startsWith('/*') || prevLine.startsWith('*') || prevLine.endsWith('*/')) {
      current--;
    } 
    // Check for empty lines, but only if they are preceded by a decorator
    else if (prevLine === '') {
      let foundDecoratorAbove = false;
      for (let k = 1; k <= 3; k++) {
        if (current - 1 - k >= 0) {
          const checkLine = lines[current - 1 - k].trim();
          if (checkLine.startsWith('@')) {
            foundDecoratorAbove = true;
            break;
          }
          if (checkLine !== '') break;
        }
      }
      if (foundDecoratorAbove) {
        current--;
      } else {
        break;
      }
    } 
    // Logic for multiline decorators ending with ), }, or },
    else if (prevLine.endsWith(')') || prevLine.endsWith('}') || prevLine.endsWith('},')) {
       let foundDecorator = false;
       let parenDepth = 0;
       let braceDepth = 0;
       
       // Scan upwards to find matching head
       for (let j = current - 1; j >= Math.max(0, current - 50); j--) {
         const l = lines[j];
         // Clean line for depth tracking (ignore braces in strings/comments)
         // Clean line for depth tracking (ignore braces in strings/comments)
         // CRITICAL: Replace strings BEFORE comments to avoid http:// being treated as comment
         const cleanL = l
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""')
            .replace(/`[^`]*`/g, "``")
            .replace(/\/\/.*/, '')
            .replace(/\/\*.*?\*\//g, '');

         const opensP = (cleanL.match(/\(/g) || []).length;
         const closesP = (cleanL.match(/\)/g) || []).length;
         const opensB = (cleanL.match(/\{/g) || []).length;
         const closesB = (cleanL.match(/\}/g) || []).length;
         
         parenDepth += closesP - opensP;
         braceDepth += closesB - opensB;
         
         if (parenDepth <= 0 && braceDepth <= 0 && l.trim().startsWith('@')) {
           current = j;
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
  let parenCount = 0;
  let foundMethodDefinition = false;
  let foundBodyOpening = false;
  let foundClosing = false;
  
  // Stricter regex for declarations.
  const declRegex = /^(?:export\s+)?(?:public|private|protected|static|async|readonly|class|interface|type|enum|function|const|let|var)\s+[a-zA-Z0-9_$]+/;
  // Fallback for methods without keywords: name() {
  const methodRefRegex = name ? new RegExp(`^(?:\\s*|\\s*async\\s+)\\b${name}\\b\\s*\\(`) : null;

  let currentDecoratorParenDepth = 0;
  let currentDecoratorBraceDepth = 0;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    if (trimmed === '') continue;

    const isDecorator = trimmed.startsWith('@');
    
    // CRITICAL: Replace strings BEFORE comments to avoid http:// being treated as comment
    const cleanLine = line
        .replace(/'[^']*'/g, "''")
        .replace(/"[^"]*"/g, '""')
        .replace(/`[^`]*`/g, "``")
        .replace(/\/\/.*/, '')
        .replace(/\/\*.*?\*\//g, '');

    const openBraces = (cleanLine.match(/{/g) || []).length;
    const closeBraces = (cleanLine.match(/}/g) || []).length;
    const openParens = (cleanLine.match(/\(/g) || []).length;
    const closeParens = (cleanLine.match(/\)/g) || []).length;

    if (!foundMethodDefinition) {
        if (isDecorator || currentDecoratorParenDepth > 0 || currentDecoratorBraceDepth > 0) {
            currentDecoratorParenDepth += openParens - closeParens;
            currentDecoratorBraceDepth += openBraces - closeBraces;
        } else {
            // Check for actual declaration (skipping comments)
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
                continue;
            }

            if (declRegex.test(trimmed) || (methodRefRegex && methodRefRegex.test(trimmed))) {
                foundMethodDefinition = true;
                
                // Track braces for this line
                braceCount = openBraces - closeBraces;
                parenCount = openParens - closeParens;
                
                if (openBraces > 0 && parenCount === 0) {
                    foundBodyOpening = true;
                }
            }
        }
    } else {
        braceCount += openBraces - closeBraces;
        parenCount += openParens - closeParens;
        
        if (!foundBodyOpening && openBraces > 0 && parenCount === 0) {
            foundBodyOpening = true;
        }
        
        if (foundBodyOpening && braceCount <= 0) {
            endLine = i;
            foundClosing = true;
            break;
        }
        
        if (!foundBodyOpening && trimmed.endsWith(';') && braceCount === 0 && parenCount === 0) {
             endLine = i;
             foundClosing = true;
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
