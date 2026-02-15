import fg from 'fast-glob';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
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

      // Find all methods in the service class
      // Simplified but effective regex for method definitions
      const methodRegex = /(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+)*(\w+)\s*\([^)]*\)\s*(?::\s*[^{]*)?\{/g;
      
      let match;
      while ((match = methodRegex.exec(content)) !== null) {
        const methodName = match[1];

        // Skip constructor and lifecycle hooks
        if (['constructor', 'onModuleInit', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationBootstrap', 'onApplicationShutdown', 'onModuleInit'].includes(methodName)) continue;

        // Skip private methods (for now, we're looking for unused public interface)
        if (match[0].includes('private ')) continue;

        const methodLine = content.substring(0, match.index).split('\n').length;

        // Check if this method is used anywhere else
        const usedBy: UnusedServiceMethod['usedBy'] = [];

        for (const file of allFiles) {
          if (file === serviceFile) continue; // Skip the service file itself

          try {
            const fileContent = readFileSync(file, 'utf-8');

            // Check if this file imports the service
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
              // Also check for optional chaining
              const optionalChainRegex = new RegExp(`this\\.${propName}\\?\\.${methodName}\\s*\\(`);
              if (optionalChainRegex.test(fileContent)) {
                usageFound = true;
                break;
              }
            }

            if (!usageFound) {
              // Direct usage without 'this' (e.g. static calls or passed as arg)
              const directCallRegex = new RegExp(`\\.${methodName}\\s*\\(`);
              if (directCallRegex.test(fileContent)) {
                 // Heuristic: check if class name or file name is mentioned near it
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
              break; // Optimization: stop checking this file if we found usage
            }
          } catch {
            // Skip unreadable files
          }
        }

        // If not used by any external file, add to unused list
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
    } catch (err) {
      console.error(`Error scanning service ${serviceFile}:`, err);
    }
  }

  return { total: methods.length, methods };
}
