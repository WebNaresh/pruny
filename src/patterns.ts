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
  /useSWR\s*(?:<[^>]+>)?\s*\(\s*['"`]\/api\/([^'"`\s)]+)['"`]/g,

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
  // axios.get/post/put/delete/patch (Literals)
  { regex: /(?:axios|api|http|client|service)!?\.get\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'GET' },
  { regex: /(?:axios|api|http|client|service)!?\.post\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'POST' },
  { regex: /(?:axios|api|http|client|service)!?\.put\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'PUT' },
  { regex: /(?:axios|api|http|client|service)!?\.delete\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'DELETE' },
  { regex: /(?:axios|api|http|client|service)!?\.patch\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'PATCH' },

  // axios.get/post/put/delete/patch (Template Literals)
  // IMPORTANT: Use [^`\n] to prevent false multi-line matches
  { regex: /(?:axios|api|http|client|service)!?\.get\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'GET' },
  { regex: /(?:axios|api|http|client|service)!?\.post\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'POST' },
  { regex: /(?:axios|api|http|client|service)!?\.put\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'PUT' },
  { regex: /(?:axios|api|http|client|service)!?\.delete\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'DELETE' },
  { regex: /(?:axios|api|http|client|service)!?\.patch\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'PATCH' },

  // useSWR default is GET
  { regex: /useSWR\s*(?:<[^>]+>)?\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: 'GET' },
  { regex: /useSWR\s*(?:<[^>]+>)?\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: 'GET' },
  
  // Generic patterns
  { regex: /fetch\s*\(\s*['"`](\/[^'"`\s)]+)['"`]/g, method: undefined },
  { regex: /fetch\s*\(\s*`([^`\n]*?\/[^`\n]*)`/g, method: undefined },
  
  // Paths starting with /api/
  { regex: /['"`](\/api\/[^'"`\s]+)['"`]/g, method: undefined },
  { regex: /`([^`\n]*?\/api\/[^`\n]*)`/g, method: undefined },

  // Template literal with variable prefix: `${baseUrl}/...` or `/api/...` - allow assignments (remove suffix validation)
  // IMPORTANT: Use [^`\n] to prevent false multi-line matches where the regex
  // spans from one template literal's closing backtick to another's opening backtick
  { regex: /`([^`\n]*?(\/[\w-]{2,}\/[^`\n]*))`/g, method: undefined },
  
  // Full URLs (http:// or https://) - capture path
  // This allows capturing single-segment paths like /health which would otherwise be ignored by the generic pattern
  { regex: /https?:\/\/[^/]+(\/[^'"`\s]*)/g, method: undefined },

  // Generic path-like strings in literals (at least 1 segment if starting with /, or 2 if containing sashes)
  { regex: /['"`](\/[\w-]{2,}\/[^'"`\s]*)['"`]/g, method: undefined },
  { regex: /['"`](\/api\/[^'"`\s]*)['"`]/g, method: undefined },
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
          path: regexMatch[1],
          method,
          start: regexMatch.index,
          end: regexMatch.index + regexMatch[0].length,
        });
      }
    }
  }

  // Deduction/filtering Strategy:
  // 1. Prioritize matches with a Method (e.g. axios.get) over generic ones.
  // 2. Prioritize longer matches (captures more context) over shorter ones (e.g. fetch(...) > 'string').
  // 3. Keep the first one encountered if duplicates.
  
  // Sort matches by quality
  matches.sort((a, b) => {
    // 1. Method priority
    const aHasMethod = a.method !== undefined;
    const bHasMethod = b.method !== undefined;
    if (aHasMethod && !bHasMethod) return -1; // a comes first
    if (!aHasMethod && bHasMethod) return 1;  // b comes first
    
    // 2. Length priority (Longer is better)
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (aLen !== bLen) return bLen - aLen; // Descending length
    
    // 3. Position priority (Earlier is better, mostly for stability)
    return a.start - b.start;
  });

  const acceptedMatches: Match[] = [];

  for (const match of matches) {
    // Check if this match is redundant (contained within an already accepted match)
    const isRedundant = acceptedMatches.some(accepted => {
        return accepted.start <= match.start && accepted.end >= match.end;
    });

    if (!isRedundant) {
        acceptedMatches.push(match);
    }
  }

  // Deduplication by key (path + method)
  const references: ApiReference[] = [];
  const seen = new Set<string>();

  for (const match of acceptedMatches) {
    const key = `${match.path}::${match.method || 'ANY'}`;
    if (!seen.has(key)) {
      references.push({ path: match.path, method: match.method });
      seen.add(key);
    }
  }

  return references;
}
