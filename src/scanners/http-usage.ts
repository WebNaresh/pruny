
import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { Config } from '../types.js';

/**
 * Scan for HTTP client usage (axios, fetch)
 */
export async function scanHttpUsage(config: Config): Promise<{ axios: number; fetch: number; got: number; ky: number }> {
  const searchDir = config.appSpecificScan ? config.appSpecificScan.appDir : config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  console.log(`   🔍 Tracking HTTP usage in: ${searchDir}`);

  // We want to scan "everywhere" for usage, including public folder (for sw.js etc)
  // regardless of ignore config for pruning.
  // So we remove "public" from the ignore list for this specific scan.
  const ignoreFolders = config.ignore.folders.filter(f => f !== 'public' && f !== '**/public');

  const files = await fg(extGlob, {
    cwd: searchDir,
    ignore: [...ignoreFolders],
    absolute: true
  });

  let axiosCount = 0;
  let fetchCount = 0;
  let gotCount = 0;
  let kyCount = 0;

  // Regex patterns
  // Matches: axios.get, axios.post, axios(, axios<T>(
  const axiosRegex = /\baxios(\.|(\s*<[^>]+>)?\s*\()/g;
  // Matches: fetch(, fetch<T>(
  const fetchRegex = /\bfetch(\s*<[^>]+>)?\s*\(/g;
  const gotRegex = /\bgot(\.|(\s*<[^>]+>)?\s*\()/g;
  const kyRegex = /\bky(\.|(\s*<[^>]+>)?\s*\()/g;

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      
      const axiosMatches = content.match(axiosRegex);
      if (axiosMatches) axiosCount += axiosMatches.length;

      const fetchMatches = content.match(fetchRegex);
      if (fetchMatches) fetchCount += fetchMatches.length;

      const gotMatches = content.match(gotRegex);
      if (gotMatches) gotCount += gotMatches.length;

      const kyMatches = content.match(kyRegex);
      if (kyMatches) kyCount += kyMatches.length;

    } catch (err) {
      // Ignore read errors
    }
  }

  return { axios: axiosCount, fetch: fetchCount, got: gotCount, ky: kyCount };
}
