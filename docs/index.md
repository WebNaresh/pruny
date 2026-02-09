# Pruny

> Find and remove unused Next.js API routes.

## Summary
Pruny is a CLI tool that scans Next.js projects (App Router) to identify API routes that are not referenced in the codebase. It supports auto-detection of usage via `fetch`, `axios`, and `useSWR`, and respects `vercel.json` cron jobs.

## Installation

```bash
npm install -g pruny
# or run directly
npx pruny
```

## Usage

### Scan Mode
Scans the current directory or specified directory for unused routes.
```bash
npx pruny
npx pruny --dir ./src
```

### Fix Mode (Deletion)
Automatically deletes the folders of unused API routes.
```bash
npx pruny --fix
```

### JSON Output
Outputs the results in JSON format for program consumption.
```bash
npx pruny --json
```

## Configuration
Pruny looks for `pruny.config.json` in the project root.

```json
{
  "dir": "./",
  "ignore": {
    "routes": ["/api/webhooks/**", "/api/cron/**"],
    "folders": ["node_modules", ".next", "dist", ".git"],
    "files": ["*.test.ts", "*.spec.ts"]
  },
  "extensions": [".ts", ".tsx", ".js", ".jsx"]
}
```

## How Detection Works
1. **Discovery**: Finds all `app/api/**/route.{ts,js}` files.
2. **Scanning**: Greps all source files for usage patterns like:
   - `fetch('/api/my-route')`
   - `axios.get('/api/my-route')`
   - `useSWR('/api/my-route')`
   - Template literals: `` `/api/${variable}` `` (matches exact prefix)
3. **Exclusions**:
   - Routes defined in `vercel.json` crons are automatically marked as used.
   - Routes matching `ignore.routes` glob patterns are skipped.

## Source Code
- Repository: https://github.com/WebNaresh/pruny
- Registry: https://www.npmjs.com/package/pruny
