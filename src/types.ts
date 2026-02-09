export interface IgnoreConfig {
  routes: string[];
  folders: string[];
  files: string[];
}

export interface Config {
  dir: string;
  ignore: IgnoreConfig;
  extensions: string[];
}

export interface ApiRoute {
  /** API path like /api/users */
  path: string;
  /** File path like app/api/users/route.ts */
  filePath: string;
  /** Whether the route is used */
  used: boolean;
  /** Files that reference this route */
  references: string[];
}

export interface ScanResult {
  total: number;
  used: number;
  unused: number;
  routes: ApiRoute[];
}

export interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}
