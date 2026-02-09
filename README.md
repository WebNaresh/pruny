# pruny

Find and remove unused Next.js API routes. 🪓

## Install

```bash
npm install -g pruny
# or
npx pruny
```

## Usage

```bash
# Scan current directory
pruny

# Scan specific folder
pruny --dir ./src

# Delete unused routes
pruny --fix

# Output as JSON
pruny --json

# Verbose output
pruny -v
```

### Public Asset Scanning (New in v1.1.0)

Pruny automatically scans your `public/` directory for unused images and files.

- **Enabled by default**: Run `npx pruny` and it will show unused assets, excluding ignored folders.
- **Disable it**: Use `--no-public` flag.
  ```bash
  pruny --no-public
  ```
- **How it works**: It checks if filenames in `public/` (e.g., `logo.png` or `/images/logo.png`) are referenced in your code.

## Config

Create `pruny.config.json` (optional):

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
