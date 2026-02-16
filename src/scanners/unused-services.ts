import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Config, UnusedServiceMethod } from '../types.js';
import { findServiceProperties } from '../fixer.js';

/**
 * Scan all service files (*.service.ts) in the project and find unused methods.
 * A method is considered unused if it's not called by any controller, other service, or module.
 */
export async function scanUnusedServices(config: Config): Promise<{ total: number; methods: UnusedServiceMethod[] }> {
  const projectRoot = config.dir;
  const methods: UnusedServiceMethod[] = [];

  // 1. Find all service files
  const candidateCwd = config.appSpecificScan ? config.appSpecificScan.appDir : projectRoot;
  const serviceFiles = fg.sync('**/*.service.{ts,tsx}', {
    cwd: candidateCwd,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**'],
    absolute: true
  });

  if (process.env.DEBUG_PRUNY) {
    console.log(`[DEBUG scanUnusedServices] Found ${serviceFiles.length} service files in ${candidateCwd}`);
  }

  // 2. Find all TypeScript files in the WHOLE project to check for usage
  const referenceCwd = config.appSpecificScan ? config.appSpecificScan.rootDir : projectRoot;
  const allFiles = fg.sync('**/*.{ts,tsx,js,jsx}', {
    cwd: referenceCwd,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/build/**'],
    absolute: true
  });

  for (const serviceFile of serviceFiles) {
    try {
      const content = readFileSync(serviceFile, 'utf-8');

      // Get the service class name
      const classMatch = content.match(/export\s+class\s+(\w+)/);
      if (!classMatch) continue;
      const serviceClassName = classMatch[1];

      // Find all methods in the service class using brace-depth tracking.
      // Only detect methods at class body level (braceDepth 1) to avoid
      // matching control flow keywords (if, for, catch, switch) inside method bodies.
      const contentLines = content.split('\n');
      let braceDepth = 0;
      let inClass = false;
      let inMultilineComment = false;

      // Names that should never be treated as service methods
      const SKIP_NAMES = new Set([
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
        'return', 'throw', 'try', 'catch', 'finally', 'new', 'delete', 'typeof',
        'instanceof', 'void', 'in', 'of', 'with', 'yield', 'await', 'class',
        'function', 'var', 'let', 'const', 'import', 'export', 'default', 'from',
        'super', 'this', 'constructor',
        'onModuleInit', 'onModuleDestroy', 'beforeApplicationShutdown',
        'onApplicationBootstrap', 'onApplicationShutdown',
      ]);

      for (let lineIdx = 0; lineIdx < contentLines.length; lineIdx++) {
        const line = contentLines[lineIdx];
        const trimmed = line.trim();

        // Track multiline comments
        if (inMultilineComment) {
          if (trimmed.includes('*/')) inMultilineComment = false;
          continue;
        }
        if (trimmed.startsWith('/*') && !trimmed.includes('*/')) {
          inMultilineComment = true;
          continue;
        }

        // Skip single-line comments and empty lines (but still count braces)
        if (trimmed.startsWith('//') || trimmed === '') {
          const cleanLine = line
            .replace(/\\./g, '__')
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""')
            .replace(/`[^`]*`/g, '``')
            .replace(/\/\/.*/, '')
            .replace(/\/\*.*?\*\//g, '');
          braceDepth += (cleanLine.match(/{/g) || []).length - (cleanLine.match(/}/g) || []).length;
          continue;
        }

        // Track class declaration
        if (/export\s+class\s+\w+/.test(line)) {
          inClass = true;
        }

        // Clean line for brace counting
        const cleanLine = line
          .replace(/\\./g, '__')
          .replace(/'[^']*'/g, "''")
          .replace(/"[^"]*"/g, '""')
          .replace(/`[^`]*`/g, '``')
          .replace(/\/\/.*/, '')
          .replace(/\/\*.*?\*\//g, '');
        const opens = (cleanLine.match(/{/g) || []).length;
        const closes = (cleanLine.match(/}/g) || []).length;

        // Only detect methods at class body level (braceDepth === 1)
        if (inClass && braceDepth === 1 && !trimmed.startsWith('@')) {
          const methodMatch = trimmed.match(/^(?:(?:public|private|protected|static|readonly|async|override)\s+)*(\w+)\s*(?:<[^>]*>)?\s*\(/);
          if (methodMatch) {
            const methodName = methodMatch[1];
            const fullMatch = methodMatch[0];

            // Skip keywords, lifecycle hooks, private methods
            if (!SKIP_NAMES.has(methodName) && !fullMatch.includes('private ')) {
              const methodLine = lineIdx + 1; // 1-indexed

              if (process.env.DEBUG_PRUNY) {
                console.log(`[DEBUG scanUnusedServices] Found method ${methodName} at line ${methodLine} (braceDepth=${braceDepth})`);
              }

              // Check if this method is used anywhere else
              const usedBy: UnusedServiceMethod['usedBy'] = [];

              for (const file of allFiles) {
                if (file === serviceFile) continue;

                try {
                  const fileContent = readFileSync(file, 'utf-8');

                  const importRegex = new RegExp(`import.*\\b${serviceClassName}\\b.*from`);
                  if (!importRegex.test(fileContent)) continue;

                  const serviceProps = findServiceProperties(fileContent, serviceClassName);

                  let usageFound = false;
                  for (const propName of serviceProps) {
                    const methodCallRegex = new RegExp(`this\\.${propName}\\.${methodName}\\s*\\(`);
                    if (methodCallRegex.test(fileContent)) {
                      usageFound = true;
                      break;
                    }
                    const optionalChainRegex = new RegExp(`this\\.${propName}\\?\\.${methodName}\\s*\\(`);
                    if (optionalChainRegex.test(fileContent)) {
                      usageFound = true;
                      break;
                    }
                  }

                  if (!usageFound) {
                    const directCallRegex = new RegExp(`\\.${methodName}\\s*\\(`);
                    if (directCallRegex.test(fileContent)) {
                      if (fileContent.includes(serviceClassName)) {
                        usageFound = true;
                      }
                    }
                  }

                  if (usageFound) {
                    let usageType: 'controller' | 'service' | 'module' = 'service';
                    if (file.includes('.controller.')) usageType = 'controller';
                    else if (file.includes('.module.')) usageType = 'module';

                    usedBy.push({ file: relative(projectRoot, file), type: usageType });
                    break;
                  }
                } catch {
                  // Skip unreadable files
                }
              }

              if (usedBy.length === 0) {
                methods.push({
                  name: methodName,
                  file: relative(projectRoot, serviceFile),
                  line: methodLine,
                  serviceClassName,
                  usedBy: []
                });
              }
            }
          }
        }

        // Update brace depth AFTER checking current line
        braceDepth += opens - closes;
      }
    } catch (err) {
      console.error(`Error scanning service ${serviceFile}:`, err);
    }
  }

  return { total: methods.length, methods };
}
