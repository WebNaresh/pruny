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

## Advanced Usage & Limitations

### Dynamic Routes & Custom Clients
Pruny detects API usage by static analysis of string literals.
- **Supported**:
  - `fetch('/api/users')`
  - `` fetch(`/api/users/${id}`) `` (Template literals with constant prefix)
  - `axios.get('/api/items')`
  - `useSWR('/api/data')`
- **Limitations**:
  - **Runtime Construction**: Routes constructed purely at runtime without a static `/api/` prefix literal cannot be detected.
    - ❌ `fetch(myUrlVariable)` -> **False Positive** (Pruny thinks route is unused)
    - ✅ `fetch('/api/' + myUrlVariable)` -> **Detected**
  - **Custom Wrappers**: If you wrap `fetch` in a custom `apiClient` without standard method names, use `// pruny-ignore` (future feature) or manually ignore the route in config.

### Monorepo / Multi-App Setup
For monorepos with multiple Next.js apps (e.g., `apps/web`, `apps/admin`):

1. **Run per package**:
   ```bash
   cd apps/web && npx pruny
   ```
2. **Run from root with --dir**:
   ```bash
   # Scan specific app
   npx pruny --dir ./apps/web
   
   # Scan another app
   npx pruny --dir ./apps/admin
   ```
   *Note: Pruny's config resolution looks for `pruny.config.json` in the specific `dir` being scanned.*

### Vercel Cron Detection
Pruny automatically parses `vercel.json` to process cron jobs.
- It looks for `crons: [{ path: "/api/cron/job" }]` array.
- Any route path found in `vercel.json` is automatically marked as **USED**.
- This prevents accidental deletion of server-side cron handlers that are never "fetched" by client code.

## Source Code
- Repository: https://github.com/WebNaresh/pruny
- Registry: https://www.npmjs.com/package/pruny
