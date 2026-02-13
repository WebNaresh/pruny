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

  // Full URL matching (http://.../api/...)
  /['"`](?:https?:\/\/[^/]+)?\/api\/([^'"`\s]+)['"`]/g,

  // Template literal with variable prefix: `${baseUrl}/api/...`
  /`[^`]*\/api\/([^`\s]+)`/g,
];

/**
 * Regex to find exported HTTP methods in route.ts files
 * Matches: export async function GET, export const POST, etc.
 */
export const EXPORTED_METHOD_PATTERN = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/g;

/**
 * NestJS Controller Pattern
 * Matches: @Controller('users') or @Controller()
 */
export const NEST_CONTROLLER_PATTERN = /@Controller\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/;

/**
 * NestJS Method Pattern
 * Matches: @Get('profile'), @Post(), etc.
 */
export const NEST_METHOD_PATTERN = /@(Get|Post|Put|Delete|Patch|Options|Head|All)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

export interface ApiReference {
  path: string;
  method?: string;
}

export const API_METHOD_PATTERNS: { regex: RegExp; method?: string }[] = [
  // axios.get/post/put/delete/patch
  { regex: /axios\.get\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'GET' },
  { regex: /axios\.post\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'POST' },
  { regex: /axios\.put\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'PUT' },
  { regex: /axios\.delete\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'DELETE' },
  { regex: /axios\.patch\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'PATCH' },

  // useSWR default is GET
  { regex: /useSWR\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: 'GET' },
  
  // Generic patterns (unknown method)
  { regex: /fetch\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g, method: undefined },
  { regex: /fetch\s*\(\s*`\/api\/([^`\s)]+)`/g, method: undefined },
  { regex: /['"`]\/api\/([^'"`\s]+)['"`]/g, method: undefined },
  { regex: /['"`](?:https?:\/\/[^/]+)?\/api\/([^'"`\s]+)['"`]/g, method: undefined },

  // Template literal with variable prefix: `${baseUrl}/api/...`
  { regex: /`[^`]*\/api\/([^`\s]+)`/g, method: undefined },
];

/**
 * Extract all API paths referenced in content with potential methods
 */
export function extractApiReferences(content: string): ApiReference[] {
  interface Match {
    path: string;
    method?: string;
    start: number;
    end: number;
  }

  const matches: Match[] = [];

  for (const { regex, method } of API_METHOD_PATTERNS) {
    regex.lastIndex = 0;
    
    let regexMatch: RegExpExecArray | null;
    while ((regexMatch = regex.exec(content)) !== null) {
      if (regexMatch[1]) {
        matches.push({
          path: '/api/' + regexMatch[1],
          method,
          start: regexMatch.index,
          end: regexMatch.index + regexMatch[0].length,
        });
      }
    }
  }

  // Filter out matches that are contained within other matches
  // e.g. axios.get('/api/users') contains '/api/users'
  const filteredMatches = matches.filter((match) => {
    return !matches.some((other) => {
      if (match === other) return false;
      // If other contains match and other has a method (is specific), discard match
      return (
        other.start <= match.start &&
        other.end >= match.end &&
        other.method !== undefined &&
        match.method === undefined
      );
    });
  });

  // Deduplicate
  const references: ApiReference[] = [];
  const seen = new Set<string>();

  for (const match of filteredMatches) {
    const key = `${match.path}::${match.method || 'ANY'}`;
    if (!seen.has(key)) {
      references.push({ path: match.path, method: match.method });
      seen.add(key);
    }
  }

  return references;
}
