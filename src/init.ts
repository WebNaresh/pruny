import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { DEFAULT_CONFIG } from './config.js';

export function init(cwd: string = process.cwd()) {
  const configPath = join(cwd, 'pruny.config.json');

  if (existsSync(configPath)) {
    console.log(chalk.yellow('⚠️  pruny.config.json already exists. Skipping.'));
    return;
  }

  try {
    const configContent = JSON.stringify(DEFAULT_CONFIG, null, 2);
    writeFileSync(configPath, configContent, 'utf-8');
    console.log(chalk.green('✅ Created pruny.config.json'));
  } catch (err) {
    console.error(chalk.red('Error creating config file:'), err);
  }
}
