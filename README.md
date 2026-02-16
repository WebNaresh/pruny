# pruny

Find and remove unused Next.js API routes & Nest.js Controllers. 🪓

## Install

```bash
npm install -g pruny
# or
npx pruny
```

## Usage

## CLI Commands

| Command                      | Description                                                                              |
| :--------------------------- | :--------------------------------------------------------------------------------------- |
| `pruny`                      | Scan for unused items interactively (monorepo-aware).                                    |
| `pruny --dir <path>`         | Set the target project directory (default: `./`).                                        |
| `pruny --app <name>`         | Scan a specific application within a monorepo.                                           |
| `pruny --folder <path>`      | Scan a specific folder OR sub-directory for routes/controllers.                          |
| `pruny --fix`                | Automatically delete unused items found during scan.                                     |
| `pruny --cleanup <items>`    | Quick cleanup: `routes`, `exports`, `public`, `files`. (e.g. `--cleanup routes,exports`) |
| `pruny --filter <pattern>`   | Filter results by string (app name, file path, etc).                                     |
| `pruny --ignore-apps <list>` | Comma-separated list of apps to skip in monorepos.                                       |
| `pruny --no-public`          | Disable scanning of public assets.                                                       |
| `pruny --json`               | Output scan results as JSON for automation.                                              |
| `pruny -v, --verbose`        | Show detailed debug logging and trace info.                                              |
| `pruny init`                 | Create a `pruny.config.json` configuration file.                                         |

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
