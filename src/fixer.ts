import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, relative } from 'node:path';
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
  let resolved = join(dir, importPath);
  
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
              return { serviceFile, serviceMethod };
          }
      }
  }

  return null;
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
  const fullPath = isAbsolute(filePath) ? filePath : join(rootDir, filePath);
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
