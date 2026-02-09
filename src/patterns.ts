/**
 * Regex patterns to detect API route usage in source files
 */
export const API_PATTERNS: RegExp[] = [
  // fetch('/api/...')
  /fetch\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // fetch(`/api/...`)
  /fetch\s*\(\s*`\/api\/([^`\s)]+)`/g,

  // axios.get('/api/...')
  /axios\.\w+\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // useSWR('/api/...')
  /useSWR\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // useQuery with /api/
  /queryFn.*['"`]\/api\/([^'"`\s)]+)['"`]/g,

  // Generic string containing /api/
  /['"`]\/api\/([^'"`\s]+)['"`]/g,
];

/**
 * Extract all API paths referenced in content
 */
export function extractApiPaths(content: string): string[] {
  const paths = new Set<string>();

  for (const pattern of API_PATTERNS) {
    // Reset regex lastIndex
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      // Full path including /api/
      const fullMatch = match[0];
      const pathMatch = fullMatch.match(/\/api\/[^'"`\s)]+/);
      if (pathMatch) {
        paths.add(pathMatch[0]);
      }
    }
  }

  return Array.from(paths);
}
