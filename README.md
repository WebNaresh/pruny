# pruny

Find and remove unused Next.js API routes & Nest.js Controllers. 🪓

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

# Delete unused routes/controllers
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
    "files": ["*.test.ts", "*.spec.ts"]
  },
  "extensions": [".ts", ".tsx", ".js", ".jsx"]
}
```

## Features

- 🔍 Detects unused Next.js API routes & Nest.js Controller methods
- 🗑️ `--fix` flag to delete unused routes
- ⚡ Auto-detects `vercel.json` cron routes
- 📁 Default ignores: `node_modules`, `.next`, `dist`, `.git`
- 🎨 Beautiful CLI output

## How it works

1. **Next.js**: Finds all `app/api/**/route.ts` files.
2. **Nest.js**: Finds all `*.controller.ts` files and extracts mapped routes (e.g., `@Get('users')`).
3. Scans codebase for client-side usages (e.g., `fetch`, `axios`, or string literals matching the route).
4. Reports routes with no detected references.
5. `--fix` deletes the unused route file or method.

## License

MIT
