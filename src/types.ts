export interface IgnoreConfig {
  routes: string[];
  folders: string[];
  files: string[];
}

export interface Config {
  dir: string;
  ignore: IgnoreConfig;
  extensions: string[];
  excludePublic?: boolean;
}

export interface ApiRoute {
  /** Type of route */
  type: 'nextjs' | 'nestjs';
  /** API path like /api/users */
  path: string;
  /** File path like app/api/users/route.ts */
  filePath: string;
  /** Whether the route is used */
  used: boolean;
  /** Files that reference this route */
  references: string[];
  /** Exported methods (GET, POST, etc.) */
  methods: string[];
  /** Unused methods */
  unusedMethods: string[];
}

export interface Config {
  dir: string;
  ignore: IgnoreConfig;
  extensions: string[];
  excludePublic?: boolean;
  nestGlobalPrefix?: string;
  extraRoutePatterns?: string[];
}

export interface PublicAsset {
  path: string;
  relativePath: string;
  used: boolean;
  references: string[];
}

export interface UnusedFile {
  path: string;
  size: number;
}

export interface ScanResult {
  total: number;
  used: number;
  unused: number;
  routes: ApiRoute[];
  publicAssets?: {
    total: number;
    used: number;
    unused: number;
    assets: PublicAsset[];
  };
  unusedFiles?: {
    total: number;
    used: number;
    unused: number;
    files: UnusedFile[];
  };
  unusedExports?: {
    total: number;
    used: number;
    unused: number;
    exports: UnusedExport[];
  };
}

export interface UnusedExport {
  name: string;
  file: string;
  line: number;
  usedInternally: boolean; // Whether the export is used within the same file
}

export interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}
