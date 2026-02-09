#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scan } from './scanner.js';
import { loadConfig } from './config.js';

const program = new Command();

program
  .name('zoink')
  .description('Find and remove unused Next.js API routes')
  .version('1.0.0')
  .option('-d, --dir <path>', 'Target directory to scan', './')
  .option('--fix', 'Delete unused API routes')
  .option('-c, --config <path>', 'Path to config file')
  .option('--json', 'Output as JSON')
  .option('-v, --verbose', 'Show detailed info')
  .action(async (options) => {
    const config = loadConfig({
      dir: options.dir,
      config: options.config,
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
      console.log(chalk.green(`   Used routes:   ${result.used}`));
      console.log(chalk.red(`   Unused routes: ${result.unused}`));
      console.log('');

      if (result.total === 0) {
        console.log(chalk.yellow('⚠️  No API routes found.\n'));
        return;
      }

      const unused = result.routes.filter((r) => !r.used);

      if (unused.length === 0) {
        console.log(chalk.green('✅ All API routes are used!\n'));
        return;
      }

      // List unused routes
      console.log(chalk.red.bold('❌ Unused routes:\n'));
      for (const route of unused) {
        console.log(chalk.red(`   ${route.path}`));
        console.log(chalk.dim(`      → ${route.filePath}`));
      }
      console.log('');

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
        console.log(chalk.yellow.bold('🗑️  Deleting unused routes...\n'));

        for (const route of unused) {
          const routeDir = dirname(join(config.dir, route.filePath));
          try {
            rmSync(routeDir, { recursive: true, force: true });
            console.log(chalk.red(`   Deleted: ${route.filePath}`));
          } catch (err) {
            console.log(
              chalk.yellow(`   Failed to delete: ${route.filePath}`)
            );
          }
        }

        console.log(
          chalk.green(`\n✅ Deleted ${unused.length} unused route(s).\n`)
        );
      } else {
        console.log(
          chalk.dim('💡 Run with --fix to delete unused routes.\n')
        );
      }
    } catch (err) {
      console.error(chalk.red('Error scanning:'), err);
      process.exit(1);
    }
  });

program.parse();
