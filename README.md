# zoink

Find and remove unused Next.js API routes. ✂️

## Install

```bash
npm install -g zoink
# or
npx zoink
```

## Usage

```bash
# Scan current directory
zoink

# Scan specific folder
zoink --dir ./src

# Delete unused routes
zoink --fix

# Output as JSON
zoink --json

# Verbose output
zoink -v
```

## Config

Create `zoink.config.json` (optional):

```json
{
  "dir": "./",
  "ignore": {
    "routes": ["/api/webhooks/**", "/api/cron/**"],
    "folders": ["node_modules", ".next", "dist"],
    "files": ["*.test.ts"]
  },
  "extensions": [".ts", ".tsx", ".js", ".jsx"]
}
```

## Features

- 🔍 Detects unused Next.js API routes
- 🗑️ `--fix` flag to delete unused routes
- ⚡ Auto-detects `vercel.json` cron routes
- 📁 Default ignores: `node_modules`, `.next`, `dist`, `.git`
- 🎨 Beautiful CLI output

## How it works

1. Finds all `app/api/**/route.ts` files
2. Scans codebase for `fetch('/api/...')` patterns
3. Reports routes with no references
4. `--fix` deletes the route folder

## License

MIT
