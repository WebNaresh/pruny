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
function findDeclarationIndex(lines: string[], name: string, approximateLine: number): number {
  const start = Math.max(0, approximateLine - 5);
  const end = Math.min(lines.length, approximateLine + 5);
  for (let i = start; i < end; i++) {
    if (lines[i].toLowerCase().includes(name.toLowerCase())) return i;
  }
  return -1;
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

         // Safety check: If we hit another method or class/function definition, STOP.
         if (/\b(class|constructor|function|interface|enum)\b/.test(cleanL) || 
             (/^[a-zA-Z0-9_$]+\s*\(/.test(l.trim()) && !l.trim().startsWith('@'))) {
            break;
         }

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
  // CRITICAL FIX: NestJS methods often don't have visibility keywords.
  // We need to allow `identifier(...)` BUT avoid identifying random code lines as start.
  // We look for identifier followed by optional generic <...> then (...)
  const declRegex = /^(?:export\s+)?(?:public|private|protected|static|async|readonly|class|interface|type|enum|function|const|let|var)?\s*[a-zA-Z0-9_$]+(?:<[^>]+>)?\s*\(/;
  
  // Fallback for methods without keywords: name() {
  const methodRefRegex = name ? new RegExp(`^\\s*(?:async\\s+)?\\b${name}\\b\\s*\\(`) : null;

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

            const isDecl = declRegex.test(trimmed);
            const isRef = methodRefRegex && methodRefRegex.test(trimmed);

            if (isDecl || isRef) {
                if (process.env.DEBUG_PRUNY) {
                   console.log(`[FIXER DEBUG] Found method definition at line ${i+1}: ${trimmed}`);
                   console.log(`[FIXER DEBUG] Matched: decl=${isDecl}, ref=${isRef}`);
                }
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
      
      if (lines.some(l => l.includes('get_revenue'))) {
          console.log(`[FIXER TRACE] Deleting ${linesToDelete} lines starting at ${startLine}. End: ${endLine}`);
      }
      
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
