#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scan } from './scanner.js';
import { loadConfig } from './config.js';

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
  .action(async (options) => {
    const config = loadConfig({
      dir: options.dir,
      config: options.config,
      excludePublic: !options.public, // commander handles --no-public as public: false
    });

    // Resolve absolute path
    const absoluteDir = config.dir.startsWith('/')
      ? config.dir
      : join(process.cwd(), config.dir);
    config.dir = absoluteDir;

    if (options.verbose) {
      console.log(chalk.dim('\nConfig:'));
      console.log(chalk.dim(JSON.stringify(config, null, 2)));
      console.log('');
    }

    console.log(chalk.bold('\n🔍 Scanning for unused API routes...\n'));

    try {
      const result = await scan(config);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      // Summary
      console.log(chalk.bold('📊 Results\n'));
      console.log(`   Total routes:  ${result.total}`);
      console.log(chalk.green(`   Full use:      ${result.routes.filter(r => r.used && r.unusedMethods.length === 0).length}`));
      console.log(chalk.yellow(`   Partial use:   ${result.routes.filter(r => r.used && r.unusedMethods.length > 0).length}`));
      console.log(chalk.red(`   Unused:        ${result.unused}`));
      
      if (result.publicAssets) {
        console.log('');
        console.log(chalk.bold('🖼️  Public Assets'));
        console.log(`   Total assets:  ${result.publicAssets.total}`);
        console.log(chalk.green(`   Used assets:   ${result.publicAssets.used}`));
        console.log(chalk.red(`   Unused assets: ${result.publicAssets.unused}`));
      }
      console.log('');

      // 1. Fully Unused API Routes
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

      // 2. Partially Unused API Routes
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

      if (unusedRoutes.length === 0 && partiallyUnusedRoutes.length === 0) {
        console.log(chalk.green('✅ All API routes and methods are used!\n'));
      }

      // 2. Public Assets Logic
      if (result.publicAssets) {
        const unusedAssets = result.publicAssets.assets.filter(a => !a.used);
        if (unusedAssets.length > 0) {
          console.log(chalk.red.bold('❌ Unused Public Assets:\n'));
          for (const asset of unusedAssets) {
            console.log(chalk.red(`   ${asset.relativePath}`));
            console.log(chalk.dim(`      → ${asset.path}`));
          }
          console.log('');
        } else if (result.publicAssets.total > 0) {
          console.log(chalk.green('✅ All public assets are used!\n'));
        }
      }

      // Show used routes in verbose mode
      if (options.verbose) {
        const used = result.routes.filter((r) => r.used);
        if (used.length > 0) {
          console.log(chalk.green.bold('✅ Used routes:\n'));
          for (const route of used) {
            console.log(chalk.green(`   ${route.path}`));
            if (route.references.length > 0) {
              for (const ref of route.references.slice(0, 3)) {
                console.log(chalk.dim(`      ← ${ref}`));
              }
              if (route.references.length > 3) {
                console.log(
                  chalk.dim(`      ... and ${route.references.length - 3} more`)
                );
              }
            }
          }
          console.log('');
        }
      }

      // --fix: Delete unused routes
      if (options.fix) {
        if (unusedRoutes.length > 0) {
          console.log(chalk.yellow.bold('🗑️  Deleting unused routes...\n'));

          for (const route of unusedRoutes) {
            const routeDir = dirname(join(config.dir, route.filePath));
            try {
              rmSync(routeDir, { recursive: true, force: true });
              console.log(chalk.red(`   Deleted: ${route.filePath}`));
            } catch (_err) {
              console.log(
                chalk.yellow(`   Failed to delete: ${route.filePath}`)
              );
            }
          }

          console.log(
            chalk.green(`\n✅ Deleted ${unusedRoutes.length} unused route(s).\n`)
          );
        } else {
          console.log(chalk.yellow('No unused routes to delete.\n'));
        }
      } else if (unusedRoutes.length > 0) {
        console.log(
          chalk.dim('💡 Run with --fix to delete unused routes.\n')
        );
      }
    } catch (_err) {
      console.error(chalk.red('Error scanning:'), _err);
      process.exit(1);
    }
  });

program.parse();
