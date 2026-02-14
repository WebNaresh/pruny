import fg from 'fast-glob';
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import type { Config } from '../types.js';

export interface SourceAsset {
  path: string;        // Absolute path
  relativePath: string; // Path relative to appDir
  used: boolean;
  references: string[];
}

export interface SourceAssetScanResult {
  total: number;
  used: number;
  unused: number;
  assets: SourceAsset[];
}

/**
 * Scan for unused assets in source directories (images, fonts, etc.)
 */
export async function scanSourceAssets(config: Config): Promise<SourceAssetScanResult> {
  const cwd = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const ignore = [...config.ignore.folders, ...config.ignore.files, 'public/**', '**/node_modules/**'];

  // 1. Find all asset files
  const assetExtensions = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'avif', 'mp4', 'webm'];
  const assetGlob = `**/*.{${assetExtensions.join(',')}}`;
  
  const assetFiles = await fg(assetGlob, {
    cwd,
    ignore,
    absolute: true
  });

  if (assetFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, assets: [] };
  }

  // Map absolute path -> Asset object
  const assetMap = new Map<string, SourceAsset>();
  for (const file of assetFiles) {
    assetMap.set(file, {
      path: file,
      relativePath: relative(cwd, file),
      used: false,
      references: []
    });
  }

  // 2. Find all source code files to scan for usage
  const sourceExtensions = config.extensions; // .ts, .tsx, .js, .jsx
  const sourceGlob = `**/*{${sourceExtensions.join(',')}}`;
  
  const sourceFiles = await fg(sourceGlob, {
    cwd,
    ignore,
    absolute: true
  });

  // 3. Scan code for imports/references
  // Simple check: does the file content contain the asset filename?
  // Robust check: does it import it?
  // We'll use a mix: stricter check for imports, looser for string refs?
  // Actually, for assets in source, they are usually imported like: import logo from './logo.png'
  // Or used in CSS/SCSS? (We are only scanning JS/TS files for now per config.extensions)
  
  for (const src of sourceFiles) {
    const content = readFileSync(src, 'utf-8');
    
    for (const [assetPath, asset] of assetMap) {
      if (asset.used) continue; // Already marked used

      const assetFilename = asset.relativePath.split('/').pop()!; // e.g. logo.png
      
      // 1. Check filename (e.g. "logo.png")
      if (content.includes(assetFilename)) {
          asset.used = true;
          asset.references.push(src);
          continue;
      }

      // 2. Check basename (e.g. "logo")
      // Only if length > 4 to avoid false positives
      const basename = assetFilename.split('.')[0];
      if (basename.length > 4 && content.includes(basename)) {
          asset.used = true;
          asset.references.push(src);
          continue;
      }
    }
  }

  const assets = Array.from(assetMap.values());
  const used = assets.filter(a => a.used).length;
  const unused = assets.length - used;

  return {
    total: assets.length,
    used,
    unused,
    assets
  };
}
