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

  if (hintIndex < lines.length && lines[hintIndex].includes(searchName)) return hintIndex;
  
  for (let i = 1; i < 50; i++) {
    if (hintIndex - i >= 0 && lines[hintIndex - i].includes(searchName)) return hintIndex - i;
    if (hintIndex + i < lines.length && lines[hintIndex + i].includes(searchName)) return hintIndex + i;
  }
  
  return lines.findIndex(l => l.includes(searchName));
}

/**
 * Find the true start of a declaration, including preceding decorators
 */
function findDeclarationStart(lines: string[], lineIndex: number): number {
  let current = lineIndex;
  
  while (current > 0) {
    const prevLine = lines[current - 1].trim();
    if (prevLine.startsWith('@') || prevLine.startsWith('//') || prevLine.startsWith('/*')) {
      current--;
    } else if (prevLine === '') {
      if (current > 1 && lines[current - 2].trim().startsWith('@')) {
        current--;
      } else {
        break;
      }
    } else if (prevLine.endsWith(')') || prevLine.endsWith('}') || prevLine.endsWith('},')) {
       let foundDecorator = false;
       for (let j = current - 1; j >= Math.max(0, current - 20); j--) {
         if (lines[j].trim().startsWith('@')) {
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
  let foundBodyOpening = false;
  let reachedSignature = name === null;
  let foundClosing = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!reachedSignature && name && line.includes(name)) {
      reachedSignature = true;
    }

    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    braceCount += openBraces - closeBraces;

    if (reachedSignature && !foundBodyOpening && openBraces > 0) {
      foundBodyOpening = true;
    }

    if (foundBodyOpening && braceCount <= 0) {
      endLine = i;
      foundClosing = true;
      break;
    }

    // fallback for semicolons if no body found after signature
    if (reachedSignature && !foundBodyOpening && braceCount === 0) {
      if (trimmed.endsWith(';') || trimmed.includes('};')) {
        endLine = i;
        foundClosing = true;
        break;
      }
      
      // If we see next method/decorator, stop before it
      if (i > startLine && (trimmed.startsWith('@') || trimmed.match(/^(?:export\s+)?(?:async\s+)?(?:function|const|class|let|var|public|private|protected)\s+/))) {
        endLine = i - 1;
        foundClosing = true;
        break;
      }
      
      if (i > startLine + 10) {
         endLine = i - 1;
         foundClosing = true;
         break;
      }
    }
  }

  // If we reached signature but never found a body/terminator, 
  // try to find a semicolon close by
  if (!foundClosing && reachedSignature && lines.length > startLine) {
     endLine = startLine;
     for (let k = startLine; k < Math.min(lines.length, startLine + 10); k++) {
         if (lines[k].trim().endsWith(';') || lines[k].trim().includes('};')) {
           endLine = k;
           foundClosing = true;
           break;
         }
     }
  }

  if (!foundClosing) endLine = startLine;

  const linesToDelete = endLine - startLine + 1;
  lines.splice(startLine, linesToDelete);
  return linesToDelete;
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
