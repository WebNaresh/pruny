# skrt

Find and remove unused Next.js API routes. ✂️

## Install

```bash
npm install -g skrt
# or
npx skrt
```

## Usage

```bash
# Scan current directory
skrt

# Scan specific folder
skrt --dir ./src

# Delete unused routes
skrt --fix

# Output as JSON
skrt --json

# Verbose output
skrt -v
```

## Config

Create `skrt.config.json` (optional):

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
