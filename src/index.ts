#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scan } from './scanner.js';
import { loadConfig } from './config.js';
import { removeExportFromLine } from './fixer.js';
import { init } from './init.js';

interface PrunyOptions {
  dir: string;
  config?: string;
  fix?: boolean;
  json?: boolean;
  public: boolean;
  verbose?: boolean;
  filter?: string;
}

interface SummaryItem {
  Category: string;
  Total: number | string;
  Used: number | string;
  Unused: number | string;
}

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
  .option('-f, --filter <pattern>', 'Filter results by file path or app name');

program
  .command('init')
  .description('Create a default pruny.config.json file')
  .action(() => {
    init();
  });

program.action(async (options: PrunyOptions) => {
    const startTime = Date.now();
    const config = loadConfig({
      dir: options.dir,
      config: options.config,
      excludePublic: !options.public,
    });

    const absoluteDir = config.dir.startsWith('/')
      ? config.dir
      : join(process.cwd(), config.dir);
    config.dir = absoluteDir;

    if (options.verbose) {
      // console.log(chalk.dim('\nConfig:'));
      // console.log(chalk.dim(JSON.stringify(config, null, 2)));
      console.log('');
    }

    console.log(chalk.bold('\n🔍 Scanning for unused API routes...\n'));

    try {
      let result = await scan(config);

      const getAppName = (filePath: string) => {
        if (filePath.startsWith('apps/')) return filePath.split('/').slice(0, 2).join('/');
        if (filePath.startsWith('packages/')) return filePath.split('/').slice(0, 2).join('/');
        return 'Root';
      };

      // Filter Logic
      if (options.filter) {
        const filter = options.filter.toLowerCase();
        console.log(chalk.blue(`\n🔍 Filtering results by "${filter}"...\n`));

        const matchesFilter = (path: string) => {
            const lowerPath = path.toLowerCase();
            const appName = getAppName(path).toLowerCase();
            
            // Check if app name matches
            if (appName.includes(filter)) return true;
            
            // Split path into segments and check each
            const segments = lowerPath.split('/');
            
            // Match exact segment (folder name) or filename without extension
            for (const segment of segments) {
              // Exact segment match (e.g., "hero-highlight" matches folder)
              if (segment === filter) return true;
              
              // Filename without extension match (e.g., "hero-highlight" matches "hero-highlight.tsx")
              const withoutExt = segment.replace(/\.[^.]+$/, '');
              if (withoutExt === filter) return true;
            }
            
            // Fallback: partial match for compatibility
            return lowerPath.includes(filter);
        };

        // Filter Routes
        result.routes = result.routes.filter(r => matchesFilter(r.filePath));

        // Filter Public Assets
        if (result.publicAssets) {
            result.publicAssets.assets = result.publicAssets.assets.filter(a => matchesFilter(a.path));
            result.publicAssets.total = result.publicAssets.assets.length;
            result.publicAssets.used = result.publicAssets.assets.filter(a => a.used).length;
            result.publicAssets.unused = result.publicAssets.assets.filter(a => !a.used).length;
        }

        // Filter Unused Files
        if (result.unusedFiles) {
            result.unusedFiles.files = result.unusedFiles.files.filter(f => matchesFilter(f.path));
            result.unusedFiles.total = result.unusedFiles.files.length;
            result.unusedFiles.used = 0; // Not tracking used files in this list
            result.unusedFiles.unused = result.unusedFiles.files.length;
        }

        // Filter Exports
        if (result.unusedExports) {
            result.unusedExports.exports = result.unusedExports.exports.filter(e => matchesFilter(e.file));
            result.unusedExports.total = result.unusedExports.exports.length;
            result.unusedExports.used = 0; // Not tracking used exports in this list
            result.unusedExports.unused = result.unusedExports.exports.length;
        }
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // 1. Partially Unused API Routes
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

      // 2. Fully Unused API Routes
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

      // 3. Public Assets Logic
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

      // 4. Unused Files Logic
      if (result.unusedFiles && result.unusedFiles.files.length > 0) {
        console.log(chalk.red.bold('📄 Unused Source Files:\n'));
        for (const file of result.unusedFiles.files) {
          const sizeKb = (file.size / 1024).toFixed(1);
          console.log(chalk.red(`   ${file.path} ${chalk.dim(`(${sizeKb} KB)`)}`));
        }
        console.log('');
      }

      // 5. Unused Exports Logic
      if (result.unusedExports && result.unusedExports.exports.length > 0) {
        console.log(chalk.red.bold('🔗 Unused Named Exports:\n'));
        for (const exp of result.unusedExports.exports) {
          console.log(chalk.red(`   ${exp.name}`));
          console.log(chalk.dim(`      → ${exp.file}:${exp.line}`));
        }
        console.log('');
      }

      // 6. Everything is used?
      if (unusedRoutes.length === 0 && partiallyUnusedRoutes.length === 0 && (!result.publicAssets || result.publicAssets.unused === 0)) {
        console.log(chalk.green('✅ Everything is used! Clean as a whistle.\n'));
      }

      // 7. --fix Logic (Move BEFORE summary)
      if (options.fix) {
        // 1. Delete unused routes
        if (unusedRoutes.length > 0) {
          console.log(chalk.yellow.bold('🗑️  Deleting unused routes...\n'));
          for (const route of unusedRoutes) {
            const routeDir = dirname(join(config.dir, route.filePath));
            try {
              rmSync(routeDir, { recursive: true, force: true });
              console.log(chalk.red(`   Deleted: ${route.filePath}`));
            } catch (_err) {
              console.log(chalk.yellow(`   Failed to delete: ${route.filePath}`));
            }
          }
        }

        // 2. Fix unused exports
        if (result.unusedExports && result.unusedExports.exports.length > 0) {
          console.log(chalk.yellow.bold('🔧 Fixing unused exports (removing "export" keyword)...\n'));
          
          // Group exports by file
          const exportsByFile = new Map<string, typeof result.unusedExports.exports>();
          for (const exp of result.unusedExports.exports) {
            if (!exportsByFile.has(exp.file)) {
              exportsByFile.set(exp.file, []);
            }
            exportsByFile.get(exp.file)!.push(exp);
          }
          
          let fixedCount = 0;
          for (const [file, exports] of exportsByFile.entries()) {
            const sortedExports = exports.sort((a, b) => b.line - a.line);
            
            for (const exp of sortedExports) {
              if (removeExportFromLine(config.dir, exp)) {
                console.log(chalk.green(`   Fixed: ${exp.name} in ${exp.file}`));
                fixedCount++;
              }
            }
          }
          
          if (fixedCount > 0) {
            console.log(chalk.green(`\n✅ Removed "export" from ${fixedCount} item(s).\n`));
          }
        }
      } else if (unusedRoutes.length > 0 || (result.unusedExports && result.unusedExports.exports.length > 0)) {
        console.log(chalk.dim('💡 Run with --fix to automatically clean up unused routes and exports.\n'));
      }

      // 9. Summary Table (Final Position before timer)
      console.log(chalk.bold('📊 Summary Report\n'));
      
      const summary: SummaryItem[] = [];

      // Group by App + Type
      const groupedRoutes = new Map<string, { type: string; app: string; routes: typeof result.routes }>();

      for (const route of result.routes) {
        const keyAppName = getAppName(route.filePath);
        const key = `${keyAppName}::${route.type}`;
        
        if (!groupedRoutes.has(key)) {
            groupedRoutes.set(key, { type: route.type, app: keyAppName, routes: [] });
        }
        groupedRoutes.get(key)!.routes.push(route);
      }

      // Sort keys
      const sortedKeys = Array.from(groupedRoutes.keys()).sort((a, b) => {
        const [appA, typeA] = a.split('::');
        const [appB, typeB] = b.split('::');
        if (typeA !== typeB) return typeA === 'nextjs' ? -1 : 1;
        return appA.localeCompare(appB);
      });

      for (const key of sortedKeys) {
        const group = groupedRoutes.get(key)!;
        const typeLabel = group.type === 'nextjs' ? 'Next.js' : 'NestJS';
        const label = `${typeLabel} (${group.app})`;

        summary.push({
            Category: label,
            Total: group.routes.length,
            Used: group.routes.filter(r => r.used).length,
            Unused: group.routes.filter(r => !r.used).length,
        });
      }

      if (summary.length === 0) {
         summary.push({ Category: 'API Routes', Total: result.total, Used: result.used, Unused: result.unused });
      }

      if (result.publicAssets) {
        summary.push({ 
          Category: 'Public Assets', 
          Total: result.publicAssets.total, 
          Used: result.publicAssets.used, 
          Unused: result.publicAssets.unused 
        });
      }

      if (result.unusedFiles) {
        summary.push({ 
          Category: 'Source Files', 
          Total: result.unusedFiles.total, 
          Used: result.unusedFiles.used, 
          Unused: result.unusedFiles.unused 
        });
      }

      if (result.unusedExports) {
        summary.push({ 
          Category: 'Exported Items', 
          Total: result.unusedExports.total, 
          Used: result.unusedExports.used, 
          Unused: result.unusedExports.unused 
        });
      }

      console.table(summary);

    } catch (_err) {
      console.error(chalk.red('Error scanning:'), _err);
      process.exit(1);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(chalk.dim(`\n⏱️  Completed in ${elapsed}s`));
  });

program.parse();
