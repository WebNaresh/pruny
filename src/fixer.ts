import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import type { UnusedExport } from './types.js';

/**
 * Resolve an imported class to its file path
 */
export function resolveImport(filePath: string, className: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  
  // 1. Match import { ClassName } from './path'
  const namedImportRegex = new RegExp(`import\\s+\\{[^}]*\\b${className}\\b[^}]*\\}\\s+from\\s+['"]([^'"]+)['"]`);
  const namedMatch = content.match(namedImportRegex);
  
  if (namedMatch && namedMatch[1]) {
    return resolvePath(filePath, namedMatch[1]);
  }

  // 2. Match import ClassName from './path' (Default import)
  const defaultImportRegex = new RegExp(`import\\s+${className}\\s+from\\s+['"]([^'"]+)['"]`);
  const defaultMatch = content.match(defaultImportRegex);
  
  if (defaultMatch && defaultMatch[1]) {
    return resolvePath(filePath, defaultMatch[1]);
  }

  return null;
}

function resolvePath(currentFile: string, importPath: string): string {
  const dir = dirname(currentFile);
  const resolved = join(dir, importPath);
  
  // Handle extensionless imports
  if (!existsSync(resolved)) {
      if (existsSync(resolved + '.ts')) return resolved + '.ts';
      if (existsSync(resolved + '.js')) return resolved + '.js';
      if (existsSync(resolved + '/index.ts')) return resolved + '/index.ts';
  }
  return resolved;
}

/**
 * Analyze a controller method to find which service method it calls
 * Returns: { serviceFile: string, serviceMethod: string } | null
 */
export function findServiceMethodCall(controllerPath: string, controllerMethod: string, approximateLine = 0): { serviceFile: string, serviceMethod: string } | null {
  if (!existsSync(controllerPath)) return null;
  const content = readFileSync(controllerPath, 'utf-8');
  const lines = content.split('\n');
  
  // 1. Find method body
  const lineIndex = findDeclarationIndex(lines, controllerMethod, approximateLine);
  if (lineIndex === -1) return null;
  
  const start = lineIndex;
  const end = Math.min(lines.length, start + 50); 
  const bodySlice = lines.slice(start, end).join('\n');
  
  // 2. Match `this.serviceName.methodName(`
  // We first need to find the property name of the service in the constructor
  // Constructor: constructor(private readonly authService: AuthService)
  
  const constructorMatch = content.match(/constructor\s*\(([^)]+)\)/);
  if (!constructorMatch) return null;
  
  const params = constructorMatch[1];
  // Parse params: private readonly authService: AuthService
  const serviceProps: { name: string; type: string }[] = [];
  
  for (const param of params.split(',')) {
      const parts = param.trim().split(':');
      if (parts.length === 2) {
          const propName = parts[0].replace(/public|private|protected|readonly|\s/g, '');
          const propType = parts[1].trim();
          serviceProps.push({ name: propName, type: propType });
      }
  }
  
  // Now look for usage in body: this.propName.methodName
  for (const prop of serviceProps) {
      const usageRegex = new RegExp(`this\\.${prop.name}\\.([a-zA-Z0-9_]+)\\(`);
      const usageMatch = bodySlice.match(usageRegex);
      
      if (usageMatch && usageMatch[1]) {
          const serviceMethod = usageMatch[1];
          // Resolve service file
          const serviceFile = resolveImport(controllerPath, prop.type);
          if (serviceFile) {
              if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findServiceMethodCall] Found ${serviceMethod} in ${serviceFile}`);
              return { serviceFile, serviceMethod };
          }
      }
  }

  return null;
}


/**
 * Find a method's line number (1-indexed) in a file.
 * Used for directly locating service methods for cascading deletion.
 */
export function findMethodLine(filePath: string, methodName: string): number | null {
  if (!existsSync(filePath)) {
    if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findMethodLine] File not found: ${filePath}`);
    return null;
  }
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const idx = findDeclarationIndex(lines, methodName, 0);
  if (process.env.DEBUG_PRUNY) console.log(`[DEBUG findMethodLine] ${methodName} in ${filePath} -> idx=${idx}`);
  if (idx === -1) return null;
  return idx + 1; // Convert 0-indexed to 1-indexed
}

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
export function findDeclarationIndex(lines: string[], name: string, startLine = 0): number {
  // More flexible regex to handle public/private/static/async etc.
  const regex = new RegExp(`(?:public|private|protected|static|async|readonly)?\\s*(?:async)?\\s*${name}\\s*\\(`);
  
  // Start slightly before to be safe (e.g. 10 lines back)
  const actualStart = Math.max(0, startLine - 10);
  
  for (let i = actualStart; i < lines.length; i++) {
    if (regex.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Find the true start of a declaration, including preceding decorators
 */
function findDeclarationStart(lines: string[], lineIndex: number): number {
  if (lineIndex < 0 || lineIndex >= lines.length) return lineIndex;
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
export function deleteDeclaration(lines: string[], startLine: number, name: string | null): number {
  if (startLine < 0 || startLine >= lines.length) return 0;

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
 * Remove orphaned decorators (decorators with no method below them)
 * CRITICAL: Only remove decorators at class-level indentation (not inside method bodies)
 */
function cleanupOrphanedDecorators(lines: string[]): number {
  let removed = 0;
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      i++;
      continue;
    }
    
    // Found a potential decorator - but ONLY at class level (2-4 spaces indentation typically)
    if (trimmed.startsWith('@')) {
      // Check indentation - decorators inside methods have deeper indentation
      const indent = line.length - line.trimStart().length;
      
      // Class-level decorators typically have 2-4 spaces
      // Method body code has 6+ spaces
      // This is a heuristic but helps avoid false positives
      if (indent >= 6) {
        // Likely inside a method body, skip
        i++;
        continue;
      }
      
      // SAFETY: Explicitly ignore class-level decorators to prevent destroying class headers
      const CLASS_DECORATORS = new Set([
        '@ApiTags', '@Controller', '@Injectable', '@Module', 
        '@Catch', '@WebSocketGateway', '@Resolver', '@Scalar'
      ]);
      // Check if line matches any class decorator
      const isClassDec = Array.from(CLASS_DECORATORS).some(d => trimmed.startsWith(d));
      
      if (isClassDec) {
        // Skip class decorators entirely
        i++;
        continue;
      }
      
      let decoratorEnd = i;
      let parenDepth = 0;
      let braceDepth = 0;
      
      // Scan forward to find the end of this decorator (could be multiline)
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const l = lines[j];
        const cleanL = l
          .replace(/'[^']*'/g, "''")
          .replace(/\"[^\"]*\"/g, '""')
          .replace(/`[^`]*`/g, "``")
          .replace(/\/\/.*/, '')
          .replace(/\/\*.*?\*\//g, '');
        
        const opensP = (cleanL.match(/\(/g) || []).length;
        const closesP = (cleanL.match(/\)/g) || []).length;
        const opensB = (cleanL.match(/\{/g) || []).length;
        const closesB = (cleanL.match(/\}/g) || []).length;
        
        parenDepth += opensP - closesP;
        braceDepth += opensB - closesB;
        
        decoratorEnd = j;
        
        // Decorator complete when depths return to 0
        if (parenDepth <= 0 && braceDepth <= 0 && j > i) {
          break;
        }
      }
      
      // Check what comes after the decorator (within next 10 lines)
      let foundMethod = false;
      let foundClosingBrace = false;
      
      for (let j = decoratorEnd + 1; j < Math.min(lines.length, decoratorEnd + 10); j++) {
        const nextLine = lines[j].trim();
        if (nextLine === '') continue;
        
        // Another decorator - not orphaned
        if (nextLine.startsWith('@')) {
          foundMethod = true;
          break;
        }
        
        // A method definition - not orphaned
        // Look for: methodName(...) or async methodName(...) or public/private methodName(...)
        if (/^(?:export\s+)?(?:public|private|protected|static|async|readonly)?\s*[a-zA-Z0-9_$]+\s*\(/.test(nextLine)) {
          foundMethod = true;
          break;
        }
        
        // Class closing brace - orphaned!
        if (nextLine === '}') {
          foundClosingBrace = true;
          break;
        }
        
        // If we hit another class/interface/export, stop
        if (/^(export\s+)?(class|interface|enum)\s/.test(nextLine)) {
          break;
        }
      }
      
      // Only delete if we found a closing brace and no method
      if (foundClosingBrace && !foundMethod) {
        const linesToRemove = decoratorEnd - i + 1;
        lines.splice(i, linesToRemove);
        removed += linesToRemove;
        // Don't increment i, check the same position again
        continue;
      }
    }
    
    i++;
  }
  
  return removed;
}

/**
 * Removes a specific method from a route file
 */
export function removeMethodFromRoute(rootDir: string, filePath: string, methodName: string, lineNum: number): boolean {
  const fullPath = isAbsolute(filePath) ? filePath : join(rootDir, filePath);
  if (!existsSync(fullPath)) return false;

  try {
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    // 1. Find the target line index (handle shifts)
    console.log(`Looking for method ${methodName} at line ${lineNum}`);
    let targetIndex = findDeclarationIndex(lines, methodName, lineNum - 1);
    
    // Fallback: If not found at expected line (due to shifts), search from start
    if (targetIndex === -1) {
        console.log(`Method ${methodName} not found at expected line, searching from start...`);
        targetIndex = findDeclarationIndex(lines, methodName, 0);
    }
    
    if (targetIndex === -1) {
        console.log(`Method ${methodName} not found anywhere!`);
        return false;
    }
    
    console.log(`Found method ${methodName} at line ${targetIndex}`);

    // 2. Find the true start (including decorators)
    const trueStartLine = findDeclarationStart(lines, targetIndex);

    // 3. Delete the block
    const deletedLines = deleteDeclaration(lines, trueStartLine, methodName);
    
    const CLASS_DECORATORS = new Set([
      '@ApiTags', '@Controller', '@Injectable', '@Module', 
      '@Catch', '@WebSocketGateway', '@Resolver', '@Scalar'
    ]);

    // Check if line starts with a known class decorator
    const isClassDecorator = (line: string) => {
      const cleanLine = line.trim();
      for (const dec of CLASS_DECORATORS) {
        if (cleanLine.startsWith(dec)) return true;
      }
      return false;
    };

    if (deletedLines > 0) {
      // 4. Clean up any orphaned decorators left behind (iteratively for chains)
      // BUT safely skip class decorators to avoid destroying class headers
      let cleaned = 0;
      let iterations = 0;
      do {
        // Only run if we trust it won't delete class headers
        // Modified cleanupOrphanedDecorators logic must be injected or assumed safe?
        // Wait, cleanupOrphanedDecorators is defined globally in file.
        // I need to modify THE FUNCTION DEFINITION, not just the call here.
        // But for now, enable loop. I will modify function definition in NEXT step.
        cleaned = cleanupOrphanedDecorators(lines);
        iterations++;
      } while (cleaned > 0 && iterations < 5); // Safety limit on iterations
      
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

