#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { rmSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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
  .option('--ignore-apps <apps>', 'Comma-separated list of apps to ignore')
  .option('--app <name>', 'Specific app to scan')
  .option('--cleanup <items>', 'Comma-separated list of items to clean (routes, assets, files, exports)')
  .option('--folder <path>', 'Specific folder within an app or project to scan');

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

    // 2. Monorepo Detection (Auto-find root if we are inside an app)
    let monorepoRoot = absoluteDir;
    let appsDir = join(monorepoRoot, 'apps');
    let isMonorepo = existsSync(appsDir) && lstatSync(appsDir).isDirectory();

    // If not direct monorepo, try going up to find the root
    if (!isMonorepo) {
      let current = absoluteDir;
      while (current !== dirname(current)) {
        const potentialApps = join(current, 'apps');
        if (existsSync(potentialApps) && lstatSync(potentialApps).isDirectory()) {
          monorepoRoot = current;
          appsDir = potentialApps;
          isMonorepo = true;
          break;
        }
        current = dirname(current);
      }
    }

    if (isMonorepo && monorepoRoot !== absoluteDir) {
        // We are scanning an app inside a monorepo
        const appName = absoluteDir.split('/').pop() || '';
        console.log(chalk.dim(`📦 Detected monorepo root: ${monorepoRoot}`));
        
        // If we were pointed at a specific app, we should only scan that app's routes
        // but scan the whole root for references.
    }

    // Start Main Navigation Loop
    while (true) {
      const appsToScan: string[] = [];
      const ignoredApps = options.ignoreApps ? options.ignoreApps.split(',').map(a => a.trim()) : [];

      if (isMonorepo) {
        if (monorepoRoot !== absoluteDir) {
           // Direct App Scan (Run from inside an app)
           const appName = relative(join(monorepoRoot, 'apps'), absoluteDir);
           appsToScan.push(appName);
        } else {
            const apps = readdirSync(appsDir);
            const availableApps: string[] = [];
    
            for (const app of apps) {
              const appPath = join(appsDir, app);
              if (lstatSync(appPath).isDirectory()) {
                availableApps.push(app);
              }
            }
    
            // Interactive Mode: If no specific ignored apps/filter/json provided
            if (options.app) {
               if (availableApps.includes(options.app)) {
                   appsToScan.push(options.app);
               } else {
                   console.log(chalk.red(`App "${options.app}" not found in ${appsDir}`));
                   process.exit(1);
               }
            } else if (options.folder) {
               appsToScan.push(...availableApps);
            } else if (!options.ignoreApps && !options.filter && !options.json) {
              const response = await prompts({
                type: 'select',
                name: 'selected',
                message: 'Select app to scan:',
                choices: [
                  ...availableApps.map(app => ({ title: app, value: app })),
                  { title: chalk.bold('Scan All Apps'), value: 'ALL' },
                  { title: chalk.gray('Exit'), value: 'EXIT' }
                ],
                hint: '- Enter to select'
              });
    
              if (!response.selected || response.selected === 'EXIT') {
                console.log(chalk.gray('Exiting.'));
                break;
              }
    
              if (response.selected === 'ALL') {
                appsToScan.push(...availableApps);
              } else {
                appsToScan.push(response.selected);
              }
            } else {
              // Non-interactive or filtered
              for (const app of availableApps) {
                if (!ignoredApps.includes(app)) {
                  appsToScan.push(app);
                }
              }
              if (appsToScan.length === 0) break; // Exit loop if nothing to scan
            }
        }

        // Deduplicate just in case
        const uniqueApps = [...new Set(appsToScan)];
        appsToScan.length = 0;
        appsToScan.push(...uniqueApps);
      } else {
        appsToScan.push('root');
      }

      let requestedBack = false;

      // 3. Scan & Fix Loop (Per App)
      for (const appName of appsToScan) {
        // Clone config to modify per app
        const currentConfig = { ...baseConfig };

        // Define app-specific context
        let appLabel = 'Root App';
        let appDir = monorepoRoot;

        if (isMonorepo) {
          appLabel = `App: ${appName}`;
          appDir = join(monorepoRoot, 'apps', appName);

          currentConfig.appSpecificScan = {
            appDir: appDir, // Scan routes ONLY here
            rootDir: monorepoRoot // Scan references EVERYWHERE
          };
        }

        currentConfig.folder = options.folder;

        console.log(chalk.bold.magenta(`\n👉 Scanning ${appLabel}...`));

        // Perform Scan
        let result = await scan(currentConfig);

        // Filter (if requested)
        if (options.filter) {
          filterResults(result, options.filter);
        }

        // Output JSON or Report
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Handle Fixes (Per App)
          if (options.fix) {
            const fixResult = await handleFixes(result, currentConfig, options, isMonorepo);
            if (fixResult === 'back') {
              requestedBack = true;
              break; 
            }
            if (fixResult === 'exit') return; // Absolute exit
          }

          if (options.verbose || !options.fix) {
            printDetailedReport(result);
          }
          console.log(chalk.dim('💡 Run with --fix to clean up.\n'));

          printSummaryTable(result, appLabel);
        }
      }

      // If we are not in a monorepo OR we finished all apps without "Back" OR non-interactive
      if (!isMonorepo || (!requestedBack && appsToScan.length > 0) || options.json || options.filter) {
        break;
      }
      
      // If "Back" was requested, it will loops and show app selection again
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
  if (result.missingAssets) {
    const count = result.missingAssets.total;
    const msg = count > 0 ? chalk.red(`   • Broken Links:   ${count}`) : chalk.green(`   • Broken Links:   0`);
    console.log(msg);
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
/**
 * Fixer logic
 */
async function handleFixes(result: ScanResult, config: Config, options: PrunyOptions, showBack: boolean): Promise<'done' | 'back' | 'exit'> {
  // --- 1. Git Safety Check ---
  const gitRoot = findGitRoot(config.dir);
  if (!gitRoot) {
    console.log(chalk.red.bold('\n⚠️  WARNING: No .git directory found!'));
    console.log(chalk.yellow('   Deletions are permanent and cannot be undone.'));
    
    const { confirm } = await prompts({
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure you want to proceed with deletion?',
      initial: false
    });

    if (!confirm) {
      console.log(chalk.gray('Aborted cleanup.'));
      return 'exit';
    }
  }

  // --- 2. Interactive Selection ---
  
  // Determine what can be cleaned
  const choices = [];
  
  // a) Unused Routes
  const unusedRoutes = result.routes.filter(r => !r.used);
  // Also partial routes
  const partiallyRoutes = result.routes.filter(r => r.used && r.unusedMethods && r.unusedMethods.length > 0);
  
  const unusedRoutesCount = unusedRoutes.length;
  const partiallyRoutesCount = partiallyRoutes.length;
  const totalRoutesIssues = unusedRoutesCount + partiallyRoutesCount;
  
  const uniqueRouteFiles = new Set([
      ...unusedRoutes.map(r => r.filePath),
      ...partiallyRoutes.map(r => r.filePath)
  ]).size;
  
  if (totalRoutesIssues > 0) {
      // Predict cascading deletions (service methods)
      console.log(chalk.dim('\nAnalyzing cascading impact...'));
      const predictedExports = await scanUnusedExports(config, [...unusedRoutes, ...partiallyRoutes], { silent: true });
      
      const allTouchedFiles = new Set<string>();
      
      // Normalize all paths to absolute to ensure deduplication
      for (const r of [...unusedRoutes, ...partiallyRoutes]) {
          allTouchedFiles.add(resolve(config.dir, r.filePath));
      }
      
      for (const e of predictedExports.exports) {
          allTouchedFiles.add(resolve(config.dir, e.file));
      }
      
      const totalFiles = allTouchedFiles.size;
      const uniqueRouteFilesAbs = new Set([...unusedRoutes, ...partiallyRoutes].map(r => resolve(config.dir, r.filePath))).size;
      const extraFiles = totalFiles - uniqueRouteFilesAbs;
      
      let title = `Unused API Routes (${totalRoutesIssues} items in ${uniqueRouteFiles} files)`;
      if (extraFiles > 0) {
          title = `Unused API Routes (${totalRoutesIssues} items + ${extraFiles} dependent files = ${totalFiles} total files)`;
      }
      
      choices.push({ title, value: 'routes' });
  } else {
      choices.push({ title: `✅ Unused API Routes (0) - All good!`, value: 'routes' });
  }

  // b) Unused Public Assets
  if (result.publicAssets) {
      if (result.publicAssets.unused > 0) {
          choices.push({ title: `Unused Public Files (${result.publicAssets.unused})`, value: 'assets' });
      } else {
          choices.push({ title: `✅ Unused Public Files (0) - All good!`, value: 'assets' });
      }
  }

  // c) Unused Source Files
  if (result.unusedFiles) {
      if (result.unusedFiles.files.length > 0) {
          choices.push({ title: `Unused Code Files (${result.unusedFiles.files.length})`, value: 'files' });
      } else {
           choices.push({ title: `✅ Unused Code Files (0) - All good!`, value: 'files' });
      }
  }

  // d) Unused Exports
  if (result.unusedExports) {
      const unusedExportsCount = result.unusedExports.exports.length;
      if (unusedExportsCount > 0) {
          const uniqueExportFiles = new Set(result.unusedExports.exports.map(e => e.file)).size;
          choices.push({ title: `Unused Exports (${unusedExportsCount} items in ${uniqueExportFiles} files)`, value: 'exports' });
      } else {
          choices.push({ title: `✅ Unused Exports (0) - All good!`, value: 'exports' });
      }
  }

  // e) Missing Assets (Broken Links)
  if (result.missingAssets) {
      const count = result.missingAssets.total;
      const title = count > 0 
          ? `⚠ Missing Assets (Broken Links) (${count})` 
          : `✅ Missing Assets (0) - All good!`;
      
      choices.push({ title, value: 'missing-assets' });
  }


  if (showBack) {
      choices.push({ title: chalk.cyan('← Back'), value: 'back' });
  }
  choices.push({ title: 'Cancel / Exit', value: 'cancel' });

  let selected = '';
  if (options.cleanup) {
      selected = 'MANUAL_OVERRIDE'; 
  } else if (process.env.AUTO_FIX_EXPORTS) {
    if (process.env.AUTO_FIX_EXPORTS === '2') {
         // Special mode to select only exports? Or just 'exports'
         // For now, let's make it select based on value or just string 'exports' if 1
         selected = 'exports'; 
         // But wait, I want to fix routes too.
         // If I want to fix EVERYTHING, I need a way to say that.
         // The prompting logic selects ONE category. "Unused API Routes", "Unused Exports", etc.
         // If I want to fix routes, I should set it to 'routes'.
         // Let's check what values I need.
         // values: 'routes', 'public', 'code', 'exports', 'missing', 'cancel'
    } else {
        // Default auto fix: usually we want to fix ALL or specific?
        // Let's support comma separated?
        // The current logic only supports selecting ONE category at a time in the loop (it loops after fix).
        // But the loop condition is `while (!exit)`.
        // So I can't easily auto-fix ALL without changing the loop structure or inputs.
        // For this task, I mainly care about 'routes' (Pass 1) and 'exports' (Pass 2).
        // I will hack it:
        // Use an env var that rotates?
        // Or just hardcode it to 'routes' (since that triggers cascading check for exports too?)
        // Wait, selecting 'routes' only fixes routes. It typically DOES NOT fix exports automatically afterwards unless configured.
        // BUT, looking at `handleFix`:
        // If 'routes', it calls `fixApiRoutes`.
        // Then it does `await scan...` again.
        // It DOES NOT automatically select 'exports' next.
        
        // So I need a way to sequentialize it.
        // I'll implement a simple queue based on env var?
        // Or just let me select via `AUTO_FIX_TYPE`.
        selected = process.env.AUTO_FIX_TYPE || 'exports';
    }
  } else {
    const response = await prompts({
        type: 'select',
        name: 'selected',
        message: 'Select items to clean up:',
        choices,
        hint: '- Enter to select'
    });
    selected = response.selected;
  }

  if (!selected || selected === 'cancel') {
      console.log(chalk.gray('Cleanup cancelled.'));
      return 'exit';
  }

  if (selected === 'back') {
      return 'back';
  }

  const selectedList = options.cleanup 
      ? options.cleanup.split(',').map(s => s.trim()) 
      : [selected];

  let fixedSomething = false;

  // --- 3. Execute Selected Cleanups ---

  // 3x. Missing Assets
  if (selectedList.includes('missing-assets')) {
      if (result.missingAssets && result.missingAssets.total > 0) {
          console.log(chalk.yellow.bold('\n⚠  Broken Links Detected:'));
          console.log(chalk.gray('   (Automatic removal is unsafe. Please manually fix the following references:)'));
          
          for (const asset of result.missingAssets.assets) {
              console.log(chalk.red.bold(`\n   ❌ Missing: ${asset.path}`));
              for (const ref of asset.references) {
                  console.log(chalk.gray(`      ➜ ${ref}`));
              }
          }
          console.log(chalk.yellow('\n   Please open these files and remove/fix the references.'));
      } else {
        console.log(chalk.green('\n✅ No missing assets found! Nothing to fix here.'));
      }
  }

  // 3a. Public Assets (Priority 1 per request)
  if (selectedList.includes('assets')) {
     if (result.publicAssets && result.publicAssets.unused > 0) {
        console.log(chalk.yellow.bold('\n🗑️  Deleting unused public assets...'));
        for (const asset of result.publicAssets.assets) {
            if (!asset.used) {
                try {
                    const fullPath = asset.path; // Already absolute
                    if (existsSync(fullPath)) {
                        rmSync(fullPath, { force: true });
                        console.log(chalk.red(`   Deleted: ${asset.relativePath}`));
                        fixedSomething = true;
                    }
                } catch (e) {
                    console.log(chalk.red(`   Failed to delete: ${asset.relativePath}`));
                }
            }
        }
        // Reset count
        result.publicAssets.unused = 0;
        result.publicAssets.assets = result.publicAssets.assets.filter(a => a.used);
     } else {
        console.log(chalk.green('\n✅ No unused public assets found!'));
     }
  }

  // 3b. API Routes
  if (selectedList.includes('routes')) {
      const unusedRoutes = result.routes.filter(r => !r.used);
      const partiallyRoutes = result.routes.filter(r => r.used && r.unusedMethods && r.unusedMethods.length > 0);
      
      console.log(`[DEBUG INDEX] Unused routes count: ${unusedRoutes.length}`);
      console.log(`[DEBUG INDEX] Partial routes count: ${partiallyRoutes.length}`);

      if (unusedRoutes.length === 0 && partiallyRoutes.length === 0) {
          console.log(chalk.green('\n✅ No unused API routes found!'));
      } else {
        // Full Route Deletion
        if (unusedRoutes.length > 0) {
          console.log(chalk.yellow.bold('\n🗑️  Deleting unused routes...'));
          const routesByFile = new Map<string, ApiRoute[]>();
          for (const r of unusedRoutes) {
            const list = routesByFile.get(r.filePath) || [];
            list.push(r);
            routesByFile.set(r.filePath, list);
          }
      
          for (const [filePath, fileRoutes] of routesByFile) {
            
            // CRITICAL FIX: In monorepo app scan, filePath is relative to ROOT, but config.dir is APP DIR.
            // join(config.dir, filePath) causes generic/path/generic/path double nesting.
            const fullPath = config.appSpecificScan 
                ? join(config.appSpecificScan.rootDir, filePath)
                : join(config.dir, filePath);

            if (!existsSync(fullPath)) {
                continue;
            }
            
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
                  console.log(`[DEBUG INDEX] Entering FULL DELETION block for ${filePath}`);
                  rmSync(fullPath, { force: true });
                  console.log(chalk.red(`   Deleted File: ${filePath}`));
                  fixedSomething = true;
                } else {
                  console.log(`[DEBUG INDEX] Entering PARTIAL DELETION block for ${filePath}`);
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
                    const rootDir = config.appSpecificScan ? config.appSpecificScan.rootDir : config.dir;
                    if (removeMethodFromRoute(rootDir, filePath, method, line)) {
                      console.log(chalk.green(`      Fixed: Removed ${method} from ${filePath}`));
                      fixedSomething = true;
                    } else {
                       console.log(chalk.red(`      FAILED to remove ${method} from ${filePath} at line ${line}`));
                    }
                  }
                }
              } else {
                  // Default deletion
                  // rmSync(fullPath, { force: true });
                  console.log(chalk.red(`   [DEBUG-DRY-RUN] Deleted File: ${filePath}`));
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
        }
        
        // Partial Route Deletion
        if (partiallyRoutes.length > 0) {
          console.log(chalk.yellow.bold('\n🔧 Fixing partially unused routes...'));
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
                route.unusedMethods = [];
            }
          }
        }
    }
  }


  // 3c. Unused Source Files
  if (selectedList.includes('files')) {
    if (result.unusedFiles && result.unusedFiles.files.length > 0) {
      console.log(chalk.yellow.bold('\n🗑️  Deleting unused source files...'));
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
    } else {
        console.log(chalk.green('\n✅ No unused source files found!'));
    }
  }

  // 3d. Unused Exports
  if (selectedList.includes('exports')) {
    if (result.unusedExports && result.unusedExports.exports.length > 0) {
        fixedSomething = (await fixUnusedExports(result, config)) || fixedSomething;
    } else {
        console.log(chalk.green('\n✅ No unused exports found!'));
    }
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
  
  return 'done';
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
    const typeLabel = group.type === 'nextjs' ? 'API Routes (Next.js)' : 'API Routes (NestJS)';
    summary.push({
        Category: `${typeLabel} (${group.app})`,
        Total: group.routes.length,
        Used: group.routes.filter(r => r.used).length,
        Unused: group.routes.filter(r => !r.used).length,
    });
  }
  
  if (summary.length === 0) summary.push({ Category: 'API Routes', Total: result.total, Used: result.used, Unused: result.unused });
  if (result.publicAssets) summary.push({ Category: 'Public Files (public/)', Total: result.publicAssets.total, Used: result.publicAssets.used, Unused: result.publicAssets.unused });
  
  if (result.missingAssets) {
      const isMissing = result.missingAssets.total > 0;
      summary.push({ 
          Category: isMissing ? chalk.red.bold('⚠ Missing Assets') : 'Missing Assets', 
          Total: result.missingAssets.total, 
          Used: '-', 
          Unused: result.missingAssets.total 
      });
  }
  
  if (result.unusedFiles) summary.push({ Category: 'Code Files (.ts/.js)', Total: result.unusedFiles.total, Used: result.unusedFiles.used, Unused: result.unusedFiles.unused });
  if (result.unusedExports) summary.push({ Category: 'Unused Exports', Total: result.unusedExports.total, Used: result.unusedExports.used, Unused: result.unusedExports.unused });

  if (result.httpUsage) {
    summary.push({
        Category: 'Axios Calls',
        Total: result.httpUsage.axios,
        Used: result.httpUsage.axios,
        Unused: '-'
    });
    summary.push({
        Category: 'Fetch Calls',
        Total: result.httpUsage.fetch,
        Used: result.httpUsage.fetch,
        Unused: '-'
    });
    summary.push({
        Category: 'Got Calls',
        Total: result.httpUsage.got,
        Used: result.httpUsage.got,
        Unused: '-'
    });
    summary.push({
        Category: 'Ky Calls',
        Total: result.httpUsage.ky,
        Used: result.httpUsage.ky,
        Unused: '-'
    });
  }

  printTable(summary);
}

function printTable(summary: any[]) {
  if (summary.length === 0) return;

  const keys = Object.keys(summary[0]);
  // Include (index) column
  const headers = ['(index)', ...keys];
  
  // Calculate widths
  // Pre-calculate formatted values
  const rows = summary.map((item, rowIndex) => {
    return [
        String(rowIndex),
        ...keys.map(k => {
            const val = item[k];
            if (val === '-') return chalk.yellow('-');
            if (typeof val === 'string') return `'${val}'`;
            return chalk.yellow(String(val));
        })
    ];
  });

  // Calculate widths based on VISIBLE length
  const colWidths = headers.map(h => h.length);

  rows.forEach(row => {
    row.forEach((val, i) => {
        // Strip ANSI codes for length
        const visibleLength = val.replace(/\x1b\[[0-9;]*m/g, '').length;
        if (visibleLength > colWidths[i]) colWidths[i] = visibleLength;
    });
  });

  // Add padding
  const PADDING = 2; // 1 space on each side
  const widths = colWidths.map(w => w + PADDING);

  // Box drawing chars
  const chars = {
    top: '─', topMid: '┬', topLeft: '┌', topRight: '┐',
    bottom: '─', bottomMid: '┴', bottomLeft: '└', bottomRight: '┘',
    mid: '─', midMid: '┼', midLeft: '├', midRight: '┤',
    left: '│', right: '│', middle: '│'
  };

  // Helper to pad string
  const pad = (str: string, width: number) => {
    const visibleLength = str.replace(/\x1b\[[0-9;]*m/g, '').length;
    return ' ' + str + ' '.repeat(width - visibleLength - 1);
  };

  // 1. Top Border
  let line = chars.topLeft + widths.map(w => chars.top.repeat(w)).join(chars.topMid) + chars.topRight;
  console.log(line);

  // 2. Headers
  line = chars.left + headers.map((h, i) => pad(h, widths[i])).join(chars.middle) + chars.right;
  console.log(line);

  // 3. Divider
  line = chars.midLeft + widths.map(w => chars.mid.repeat(w)).join(chars.midMid) + chars.midRight;
  console.log(line);

  // 4. Rows
  rows.forEach((formattedValues, rowIndex) => {
    const line = chars.left + formattedValues.map((v, i) => pad(v, widths[i])).join(chars.middle) + chars.right;
    console.log(line);
  });

  // 5. Bottom Border
  line = chars.bottomLeft + widths.map(w => chars.bottom.repeat(w)).join(chars.bottomMid) + chars.bottomRight;
  console.log(line);
}

/**
 * Recursively check for .git directory up the tree
 */
function findGitRoot(startDir: string): boolean {
  let currentDir = startDir;
  while (currentDir !== dirname(currentDir)) { // Stop at root
      if (existsSync(join(currentDir, '.git'))) {
          return true;
      }
      currentDir = dirname(currentDir);
  }
  return false;
}

