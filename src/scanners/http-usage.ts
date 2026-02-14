
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

  const files = await fg(extGlob, {
    cwd: searchDir,
    ignore: [...config.ignore.folders],
    absolute: true
  });

  let axiosCount = 0;
  let fetchCount = 0;
  let gotCount = 0;
  let kyCount = 0;

  // Regex patterns
  const axiosRegex = /\baxios(\.|[\s]*\()/g;
  const fetchRegex = /\bfetch[\s]*\(/g;
  const gotRegex = /\bgot(\.|[\s]*\()/g;
  const kyRegex = /\bky(\.|[\s]*\()/g;

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
