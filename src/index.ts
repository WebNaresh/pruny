#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scan, scanUnusedExports } from './scanner.js';
import { loadConfig } from './config.js';
import { removeExportFromLine, removeMethodFromRoute } from './fixer.js';
import { init } from './init.js';
import type { ApiRoute, Config, ScanResult, PrunyOptions } from './types.js';

// --- Types ---


interface SummaryItem {
  Category: string;
  Total: number | string;
  Used: number | string;
  Unused: number | string;
}

// --- Main CLI Action ---

const program = new Command();

program
  .name('pruny')
  .description('Find and remove unused Next.js API routes')
  .version('1.0.0')
  .option('-d, --dir <path>', 'Target directory to scan', './')
  .option('--fix', 'Delete unused API routes')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output as JSON')
  .option('--no-public', 'Disable public assets scanning')
  .option('-v, --verbose', 'Show detailed info')
  .option('-f, --filter <pattern>', 'Filter results by file path or app name')
  .option('--ignore-apps <apps>', 'Comma-separated list of apps to ignore');

program
  .command('init')
  .description('Create a default pruny.config.json file')
  .action(() => {
    init();
  });

program.action(async (options: PrunyOptions) => {
  const startTime = Date.now();

  try {
    // 1. Setup Configuration
    // 1. Setup Configuration
    const baseConfig = loadConfig({
      dir: options.dir,
      config: options.config,
      excludePublic: !options.public,
    });

    const absoluteDir = baseConfig.dir.startsWith('/')
      ? baseConfig.dir
      : join(process.cwd(), baseConfig.dir);
    baseConfig.dir = absoluteDir;

    if (options.verbose) console.log('');
    console.log(chalk.bold('\n🔍 Scanning for unused API routes...\n'));

    // 2. Monorepo Detection
    const appsDir = join(absoluteDir, 'apps');
    const isMonorepo = existsSync(appsDir) && lstatSync(appsDir).isDirectory();

    const appsToScan: string[] = [];
    const ignoredApps = options.ignoreApps ? options.ignoreApps.split(',').map(a => a.trim()) : [];

    if (isMonorepo) {
    const apps = readdirSync(appsDir);
    const availableApps: string[] = [];

    for (const app of apps) {
      const appPath = join(appsDir, app);
      if (lstatSync(appPath).isDirectory()) {
          availableApps.push(app);
      }
    }

    // Interactive Mode: If no specific ignored apps/filter/json provided
    if (!options.ignoreApps && !options.filter && !options.json) {
        const response = await prompts({
            type: 'select',
            name: 'selected',
            message: 'Select app to scan:',
            choices: [
                ...availableApps.map(app => ({ title: app, value: app })),
                { title: chalk.bold('Scan All Apps'), value: 'ALL' }
            ],
            hint: '- Enter to select'
        });

        if (response.selected === 'ALL') {
            appsToScan.push(...availableApps);
        } else if (response.selected) {
            appsToScan.push(response.selected);
        } else {
            // Cancelled
            console.log(chalk.yellow('No app selected. Exiting.'));
            process.exit(0);
        }
    } else {
        // Non-interactive or filtered
        for (const app of availableApps) {
            if (!ignoredApps.includes(app)) {
                appsToScan.push(app);
            }
        }
    }
    
    // Deduplicate just in case
    const uniqueApps = [...new Set(appsToScan)];
    appsToScan.length = 0;
    appsToScan.push(...uniqueApps);
 
    console.log(chalk.bold(`\n🏢 Monorepo Detected. Scanning apps: ${appsToScan.join(', ')}\n`));
      if (ignoredApps.length > 0) {
        console.log(chalk.dim(`   (Ignored: ${ignoredApps.join(', ')})\n`));
      }
    } else {
      appsToScan.push('root');
    }

    // 3. Scan & Fix Loop (Per App)
    for (const appName of appsToScan) {
        // Clone config to modify per app
        const currentConfig = { ...baseConfig };
        
        // Define app-specific context
        let appLabel = 'Root App';
        let appDir = absoluteDir;

        if (isMonorepo) {
            appLabel = `App: ${appName}`;
            appDir = join(absoluteDir, 'apps', appName);
            
            // Adjust ignore patterns to focus on this app but exclude others for route finding
            // However, we still scan EVERYTHING for references.
            currentConfig.appSpecificScan = {
                appDir: appDir, // Scan routes ONLY here
                rootDir: absoluteDir // Scan references EVERYWHERE
            };
        }

        console.log(chalk.bold.magenta(`\n👉 Scanning ${appLabel}...`));

        // Perform Scan
        let result = await scan(currentConfig);

        // Log Stats - Removed to avoid duplication
        // logScanStats(result, appLabel);

        // Filter (if requested)
        if (options.filter) {
            filterResults(result, options.filter);
        }

        // Output JSON or Report
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
        } else {
             // printDetailedReport(result);
            
            // Handle Fixes (Per App)
            if (options.fix) {
                await handleFixes(result, currentConfig, options);
            } else if (hasUnusedItems(result)) {
                console.log(chalk.dim('💡 Run with --fix to clean up.\n'));
            }
        
            printSummaryTable(result, appLabel);
        }
    }

  } catch (err) {
    console.error(chalk.red('Error scanning:'), err);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(chalk.dim(`\n⏱️  Completed in ${elapsed}s`));
});

program.parse();

// --- Helper Functions ---

/**
 * Log immediate statistics about what was found during the scan.
 */
function logScanStats(result: ScanResult, context: string) {
  console.log(chalk.blue.bold(`📊 stats for ${context}:`));
  console.log(chalk.blue(`   • API Routes:    ${result.total}`));
  if (result.publicAssets) {
    console.log(chalk.blue(`   • Public Assets: ${result.publicAssets.total}`));
  }
  if (result.unusedFiles) {
    console.log(chalk.blue(`   • Source Files:  ${result.unusedFiles.total}`));
  }
  if (result.unusedExports) {
    console.log(chalk.blue(`   • Exported Items: ${result.unusedExports.total}`));
  }
  console.log('');
}

/**
 * Filter the scan result object in-place based on a pattern.
 */
function filterResults(result: ScanResult, filterPattern: string) {
  const filter = filterPattern.toLowerCase();
  console.log(chalk.blue(`🔍 Filtering results by "${filter}"...\n`));

  const getAppName = (filePath: string) => {
    if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
    if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
    return 'Root';
  };

  const matchesFilter = (path: string) => {
    const lowerPath = path.toLowerCase();
    const appName = getAppName(path).toLowerCase();
    if (appName.includes(filter)) return true;
    const segments = lowerPath.split('/');
    for (const segment of segments) {
      if (segment === filter) return true;
      const withoutExt = segment.replace(/\.[^.]+$/, '');
      if (withoutExt === filter) return true;
    }
    return lowerPath.includes(filter);
  };

  // Filter Routes
  result.routes = result.routes.filter(r => matchesFilter(r.filePath));

  // Filter Assets
  if (result.publicAssets) {
    result.publicAssets.assets = result.publicAssets.assets.filter(a => matchesFilter(a.path));
    result.publicAssets.total = result.publicAssets.assets.length;
    result.publicAssets.used = result.publicAssets.assets.filter(a => a.used).length;
    result.publicAssets.unused = result.publicAssets.assets.filter(a => !a.used).length;
  }

  // Filter Files
  if (result.unusedFiles) {
    result.unusedFiles.files = result.unusedFiles.files.filter(f => matchesFilter(f.path));
    result.unusedFiles.total = result.unusedFiles.files.length;
    result.unusedFiles.unused = result.unusedFiles.files.length;
  }

  // Filter Exports
  if (result.unusedExports) {
    result.unusedExports.exports = result.unusedExports.exports.filter(e => matchesFilter(e.file));
    result.unusedExports.total = result.unusedExports.exports.length;
    result.unusedExports.unused = result.unusedExports.exports.length;
  }

  // Recalculate main stats
  result.total = result.routes.length;
  result.used = result.routes.filter(r => r.used).length;
  result.unused = result.routes.filter(r => !r.used).length;
}

/**
 * Print detailed lists of unused items.
 */
function printDetailedReport(result: ScanResult) {
  // 1. Partially Unused Routes
  const partiallyUnusedRoutes = result.routes.filter(r => r.used && r.unusedMethods.length > 0);
  if (partiallyUnusedRoutes.length > 0) {
    console.log(chalk.yellow.bold('⚠️  Partially Unused API Routes:\n'));
    for (const route of partiallyUnusedRoutes) {
      console.log(chalk.yellow(`   ${route.path}`));
      console.log(chalk.red(`      ❌ Unused: ${route.unusedMethods.join(', ')}`));
      console.log(chalk.dim(`      → ${route.filePath}`));
    }
    console.log('');
  }

  // 2. Fully Unused Routes
  const unusedRoutes = result.routes.filter((r) => !r.used);
  if (unusedRoutes.length > 0) {
    console.log(chalk.red.bold('❌ Unused API Routes (Fully Unused):\n'));
    for (const route of unusedRoutes) {
      const methods = route.methods.length > 0 ? ` (${route.methods.join(', ')})` : '';
      console.log(chalk.red(`   ${route.path}${chalk.dim(methods)}`));
      console.log(chalk.dim(`      → ${route.filePath}`));
    }
    console.log('');
  }

  // 3. Unused Assets
  if (result.publicAssets) {
    const unusedAssets = result.publicAssets.assets.filter(a => !a.used);
    if (unusedAssets.length > 0) {
      console.log(chalk.red.bold('🖼️  Unused Public Assets:\n'));
      for (const asset of unusedAssets) {
        console.log(chalk.red(`   ${asset.relativePath}`));
        console.log(chalk.dim(`      → ${asset.path}`));
      }
      console.log('');
    }
  }

  // 4. Unused Source Files
  if (result.unusedFiles && result.unusedFiles.files.length > 0) {
    console.log(chalk.red.bold('📄 Unused Source Files:\n'));
    for (const file of result.unusedFiles.files) {
      const sizeKb = (file.size / 1024).toFixed(1);
      console.log(chalk.red(`   ${file.path} ${chalk.dim(`(${sizeKb} KB)`)}`));
    }
    console.log('');
  }

  // 5. Unused Exports
  if (result.unusedExports && result.unusedExports.exports.length > 0) {
    console.log(chalk.red.bold('🔗 Unused Named Exports/Methods:\n'));
    for (const exp of result.unusedExports.exports) {
      console.log(chalk.red(`   ${exp.name}`));
      console.log(chalk.dim(`      → ${exp.file}:${exp.line}`));
    }
    console.log('');
  }

  if (!hasUnusedItems(result)) {
    console.log(chalk.green('✅ Everything is used! Clean as a whistle.\n'));
  }
}

/**
 * Check if there are any unused items in the result.
 */
function hasUnusedItems(result: ScanResult): boolean {
  const unusedRoutes = result.routes.filter(r => !r.used).length;
  const partialRoutes = result.routes.filter(r => r.used && r.unusedMethods.length > 0).length;
  const unusedAssets = result.publicAssets ? result.publicAssets.unused : 0;
  const unusedFiles = result.unusedFiles ? result.unusedFiles.unused : 0;
  const unusedExports = result.unusedExports ? result.unusedExports.unused : 0;
  
  return unusedRoutes > 0 || partialRoutes > 0 || unusedAssets > 0 || unusedFiles > 0 || unusedExports > 0;
}

/**
 * Execute fixes for unused items.
 */
async function handleFixes(result: ScanResult, config: Config, options: PrunyOptions) {
  let fixedSomething = false;

  // 1. Delete unused routes
  const unusedRoutes = result.routes.filter(r => !r.used);
  if (unusedRoutes.length > 0) {
    console.log(chalk.yellow.bold('🗑️  Deleting unused routes...\n'));
    const routesByFile = new Map<string, ApiRoute[]>();
    for (const r of unusedRoutes) {
      const list = routesByFile.get(r.filePath) || [];
      list.push(r);
      routesByFile.set(r.filePath, list);
    }

    for (const [filePath, fileRoutes] of routesByFile) {
      const fullPath = join(config.dir, filePath);
      if (!existsSync(fullPath)) continue;
      
      const route = fileRoutes[0];
      const routeDir = dirname(fullPath);

      try {
        if (route.type === 'nextjs') {
          if (filePath.includes('app/api') || filePath.includes('pages/api')) {
            rmSync(routeDir, { recursive: true, force: true });
            console.log(chalk.red(`   Deleted Folder: ${routeDir}`));
          } else {
            rmSync(fullPath, { force: true });
            console.log(chalk.red(`   Deleted File: ${filePath}`));
          }
          fixedSomething = true;
        } else if (route.type === 'nestjs') {
          const isInternallyUnused = result.unusedFiles?.files.some(f => f.path === filePath);
          
          if (isInternallyUnused || filePath.includes('api/')) {
            rmSync(fullPath, { force: true });
            console.log(chalk.red(`   Deleted File: ${filePath}`));
            fixedSomething = true;
          } else {
            // Partial deletion for NestJS controller if file is still needed
            console.log(chalk.yellow(`   Skipped File Deletion (internally used): ${filePath}`));
            const allMethodsToPrune: { method: string; line: number }[] = [];
            
            for (const r of fileRoutes) {
              for (const m of r.unusedMethods) {
                if (r.methodLines[m] !== undefined) {
                  allMethodsToPrune.push({ method: m, line: r.methodLines[m] });
                }
              }
            }
            
            allMethodsToPrune.sort((a, b) => b.line - a.line);
            
            for (const { method, line } of allMethodsToPrune) {
              if (removeMethodFromRoute(config.dir, filePath, method, line)) {
                console.log(chalk.green(`      Fixed: Removed ${method} from ${filePath}`));
                fixedSomething = true;
              }
            }
          }
        } else {
            // Default deletion
            rmSync(fullPath, { force: true });
            console.log(chalk.red(`   Deleted File: ${filePath}`));
            fixedSomething = true;
        }

        // Remove from result
        for (const r of fileRoutes) {
          const idx = result.routes.indexOf(r);
          if (idx !== -1) result.routes.splice(idx, 1);
        }
      } catch (err) {
        console.log(chalk.yellow(`   Failed to fix: ${filePath}`));
      }
    }
    console.log('');
  }
  
  // 2. Fix partially unused routes
  const partiallyRoutes = result.routes.filter(r => r.used && r.unusedMethods && r.unusedMethods.length > 0);
  if (partiallyRoutes.length > 0) {
    console.log(chalk.yellow.bold('🔧 Fixing partially unused routes...\n'));
    for (const route of partiallyRoutes) {
      const sortedMethods = [...route.unusedMethods]
        .filter(m => route.methodLines[m] !== undefined)
        .sort((a, b) => route.methodLines[b] - route.methodLines[a]);
      
      let fixedCount = 0;
      for (const method of sortedMethods) {
        const lineNum = route.methodLines[method];
        if (removeMethodFromRoute(config.dir, route.filePath, method, lineNum)) {
          console.log(chalk.green(`   Fixed: Removed ${method} from ${route.path}`));
          fixedCount++;
          fixedSomething = true;
        }
      }
      
      if (fixedCount === route.methods.length) {
          const idx = result.routes.indexOf(route);
          if (idx !== -1) result.routes.splice(idx, 1);
      } else {
          route.unusedMethods = route.unusedMethods.filter(m => !sortedMethods.includes(m));
      }
    }
    console.log('');
  }

  // 3. Delete unused source files
  if (result.unusedFiles && result.unusedFiles.files.length > 0) {
      console.log(chalk.yellow.bold('🗑️  Deleting unused source files...\n'));
      for (const file of result.unusedFiles.files) {
          try {
              const fullPath = join(config.dir, file.path);
              if (!existsSync(fullPath)) continue;
              rmSync(fullPath, { force: true });
              console.log(chalk.red(`   Deleted: ${file.path}`));
              fixedSomething = true;
          } catch (_err) {
              console.log(chalk.yellow(`   Failed to delete: ${file.path}`));
          }
      }
      result.unusedFiles.files = [];
      result.unusedFiles.unused = 0;
      console.log('');
  }

  // 4. Fix unused exports
  if (result.unusedExports && result.unusedExports.exports.length > 0) {
    fixedSomething = (await fixUnusedExports(result, config)) || fixedSomething;
  }

  // 5. CASCADING SCAN
  if (fixedSomething) {
      console.log(chalk.cyan.bold('\n🔄 Checking for cascading dead code (newly unused implementation)...'));
      const secondPass = await scanUnusedExports(config);
      
      // Apply filter to second pass if needed
      if (options.filter) {
          const filter = options.filter.toLowerCase();
           /* Filter logic for exports repeated for safety/consistency */
          const getAppName = (filePath: string) => {
            if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
            if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
            return 'Root';
          };
          const matchesFilter = (path: string) => {
             // simplified matcher for this scope
             const lowerPath = path.toLowerCase();
             const appName = getAppName(path).toLowerCase();
             if (appName.includes(filter)) return true;
             return lowerPath.includes(filter);
          };

          secondPass.exports = secondPass.exports.filter(e => matchesFilter(e.file));
          secondPass.total = secondPass.exports.length;
          secondPass.unused = secondPass.exports.length;
      }

      if (secondPass.unused > 0) {
          console.log(chalk.yellow(`   Found ${secondPass.unused} newly unused items/methods after pruning.\n`));
          result.unusedExports = secondPass;
          await fixUnusedExports(result, config);
      }
  }

  if (fixedSomething) {
      result.unused = result.routes.filter(r => !r.used).length;
      result.used = result.routes.filter(r => r.used).length;
      result.total = result.routes.length;
  }
}

/**
 * Helper to fix unused exports in the result object
 */
async function fixUnusedExports(result: ScanResult, config: Config): Promise<boolean> {
  if (!result.unusedExports || result.unusedExports.exports.length === 0) return false;
  
  console.log(chalk.yellow.bold('🔧 Fixing unused exports/methods...\n'));
  
  const exportsByFile = new Map<string, typeof result.unusedExports.exports>();
  for (const exp of result.unusedExports.exports) {
    if (!exportsByFile.has(exp.file)) exportsByFile.set(exp.file, []);
    exportsByFile.get(exp.file)!.push(exp);
  }
  
  let fixedCount = 0;
  let fixedSomething = false;
  
  for (const [file, exports] of exportsByFile.entries()) {
    // Sort reverse order to not mess up line numbers when deleting
    const sortedExports = exports.sort((a, b) => b.line - a.line);
    
    for (const exp of sortedExports) {
      const fullPath = join(config.dir, exp.file);
      if (!existsSync(fullPath)) continue;
      
      if (removeExportFromLine(config.dir, exp)) {
        console.log(chalk.green(`   Fixed: ${exp.name} in ${exp.file}`));
        fixedCount++;
        fixedSomething = true;
        
        const expIdx = result.unusedExports!.exports.indexOf(exp);
        if (expIdx !== -1) {
            result.unusedExports!.exports.splice(expIdx, 1);
            result.unusedExports!.unused--;
        }
      }
    }
  }
  
  if (fixedCount > 0) console.log(chalk.green(`\n✅ Cleaned up ${fixedCount} unused item(s).\n`));
  return fixedSomething;
}

/**
 * Print the final summary table.
 */
function printSummaryTable(result: ScanResult, context: string) {
  console.log(chalk.bold(`📊 Summary Report for ${context}\n`));
  
  const summary: SummaryItem[] = [];
  const groupedRoutes = new Map<string, { type: string; app: string; routes: ApiRoute[] }>();
  
  const getAppName = (filePath: string) => {
    if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
    if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
    return 'Root';
  };

  for (const route of result.routes) {
    const keyAppName = getAppName(route.filePath);
    const key = `${keyAppName}::${route.type}`;
    if (!groupedRoutes.has(key)) {
        groupedRoutes.set(key, { type: route.type, app: keyAppName, routes: [] });
    }
    groupedRoutes.get(key)!.routes.push(route);
  }
  
  const sortedKeys = Array.from(groupedRoutes.keys()).sort((a, b) => {
    const [appA, typeA] = a.split('::');
    const [appB, typeB] = b.split('::');
    if (typeA !== typeB) return typeA === 'nextjs' ? -1 : 1;
    return appA.localeCompare(appB);
  });
  
  for (const key of sortedKeys) {
    const group = groupedRoutes.get(key)!;
    const typeLabel = group.type === 'nextjs' ? 'Next.js' : 'NestJS';
    summary.push({
        Category: `${typeLabel} (${group.app})`,
        Total: group.routes.length,
        Used: group.routes.filter(r => r.used).length,
        Unused: group.routes.filter(r => !r.used).length,
    });
  }
  
  if (summary.length === 0) summary.push({ Category: 'API Routes', Total: result.total, Used: result.used, Unused: result.unused });
  if (result.publicAssets) summary.push({ Category: 'Public Assets', Total: result.publicAssets.total, Used: result.publicAssets.used, Unused: result.publicAssets.unused });
  if (result.unusedFiles) summary.push({ Category: 'Source Files', Total: result.unusedFiles.total, Used: result.unusedFiles.used, Unused: result.unusedFiles.unused });
  if (result.unusedExports) summary.push({ Category: 'Exported Items', Total: result.unusedExports.total, Used: result.unusedExports.used, Unused: result.unusedExports.unused });

  if (result.httpUsage) {
    summary.push({
        Category: 'Axios Calls',
        Total: result.httpUsage.axios,
        Used: result.httpUsage.axios, // Assuming all found are "used" calls
        Unused: 0
    });
    summary.push({
        Category: 'Fetch Calls',
        Total: result.httpUsage.fetch,
        Used: result.httpUsage.fetch,
        Unused: 0
    });
    summary.push({
        Category: 'Got Calls',
        Total: result.httpUsage.got,
        Used: result.httpUsage.got,
        Unused: 0
    });
    summary.push({
        Category: 'Ky Calls',
        Total: result.httpUsage.ky,
        Used: result.httpUsage.ky,
        Unused: 0
    });
  }

  console.table(summary);
}
