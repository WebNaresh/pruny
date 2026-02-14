import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface WorkerData {
  files: string[];
  cwd: string;
  chunkId: number;
}

interface WorkerResult {
  chunkId: number;
  exports: Map<string, { name: string; line: number; file: string }[]>;
  contents: Map<string, string>;
  processedCount: number;
}

const IGNORED_EXPORT_NAMES = new Set([
  'metadata',
  'viewport',
  'generateMetadata',
  'generateViewport',
  'generateStaticParams',
  'generateImageMetadata',
  'generateSitemaps',
  'dynamic',
  'dynamicParams',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'maxDuration',
  'config',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'OPTIONS',
  'default'
]);

const FRAMEWORK_METHOD_DECORATORS = new Set([
  '@Cron', '@OnEvent', '@Process', '@MessagePattern', '@EventPattern',
  '@OnWorkerEvent', '@SqsMessageHandler', '@SqsConsumerEventHandler',
  '@Post', '@Get', '@Put', '@Delete', '@Patch', '@Options', '@Head', '@All',
  '@ResolveField', '@Query', '@Mutation', '@Subscription'
]);

const NEST_LIFECYCLE_METHODS = new Set(['constructor', 'onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']);
const JS_KEYWORDS = new Set(['if', 'for', 'while', 'catch', 'switch', 'return', 'yield', 'await', 'new', 'typeof', 'instanceof', 'void', 'delete', 'try']);
const classMethodRegex = /^\s*(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^\{]*)?\{/gm;
const inlineExportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|type|interface|enum|class)\s+([a-zA-Z0-9_$]+)/gm;
const blockExportRegex = /^export\s*\{([^}]+)\}/gm;

// Process files assigned to this worker
if (parentPort && workerData) {
  const { files, cwd, chunkId } = workerData as WorkerData;
  
  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const contents = new Map<string, string>();
  let processedCount = 0;

  for (const file of files) {
    try {
      const filePath = file.startsWith('/') ? file : join(cwd, file);
      const content = readFileSync(filePath, 'utf-8');
      contents.set(file, content);

      const lines = content.split('\n');
      const isService = file.endsWith('.service.ts') || file.endsWith('.service.tsx') || 
                        file.endsWith('.controller.ts') || file.endsWith('.processor.ts') || 
                        file.endsWith('.resolver.ts');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 1. Regular exports
        inlineExportRegex.lastIndex = 0;
        let match;
        while ((match = inlineExportRegex.exec(line)) !== null) {
          const name = match[1];
          if (name && !IGNORED_EXPORT_NAMES.has(name)) {
            if (!exportMap.has(file)) exportMap.set(file, []);
            exportMap.get(file)!.push({ name, line: i + 1, file });
            if (process.env.DEBUG_PRUNY) {
              console.log(`[WORKER DEBUG] Found export: ${name} in ${file}`);
            }
          }
        }

        blockExportRegex.lastIndex = 0;
        while ((match = blockExportRegex.exec(line)) !== null) {
          const names = match[1].split(',').map((n: string) => {
            const parts = n.trim().split(/\s+as\s+/);
            return parts[parts.length - 1];
          });
          for (const name of names) {
            if (name && !IGNORED_EXPORT_NAMES.has(name)) {
              if (!exportMap.has(file)) exportMap.set(file, []);
              exportMap.get(file)!.push({ name, line: i + 1, file });
            }
          }
        }

        // 2. Class methods in services (Cascading fix)
        if (isService) {
          classMethodRegex.lastIndex = 0;
          while ((match = classMethodRegex.exec(line)) !== null) {
            const name = match[1];
            if (name && !NEST_LIFECYCLE_METHODS.has(name) && !IGNORED_EXPORT_NAMES.has(name) && !JS_KEYWORDS.has(name)) {
              // Framework awareness: Check for decorators that imply framework usage
              let isFrameworkManaged = false;
              for (let k = 1; k <= 15; k++) {
                if (i - k >= 0) {
                  const prevLine = lines[i - k].trim();
                  if (prevLine.startsWith('@') && Array.from(FRAMEWORK_METHOD_DECORATORS).some(d => prevLine.startsWith(d))) {
                    isFrameworkManaged = true;
                    break;
                  }
                  // Stop if we hit another class or public/private method (to avoid cross-contamination)
                  if (prevLine.startsWith('export class') || prevLine.includes(' constructor(') || (prevLine.includes(') {') && !prevLine.startsWith('@') && !prevLine.endsWith(')'))) {
                    break;
                  }
                }
              }

              if (isFrameworkManaged) continue;

              // Ensure it looks like a method declaration (not a call) 
              // and isn't already added (e.g. if it has 'export' prefix we caught it above)
              const existing = exportMap.get(file)?.find(e => e.name === name);
              if (!existing) {
                if (!exportMap.has(file)) exportMap.set(file, []);
                exportMap.get(file)!.push({ name, line: i + 1, file });
                if (process.env.DEBUG_PRUNY) {
                  console.log(`[WORKER DEBUG] Found candidate: ${name} in ${file}`);
                }
              }
            }
          }
        }
      }
      
      processedCount++;
      
      // Send progress update every 10 files
      if (processedCount % 10 === 0) {
        parentPort.postMessage({
          type: 'progress',
          chunkId,
          processed: processedCount,
          total: files.length
        });
      }
    } catch (err) {
      if (process.env.DEBUG_PRUNY) {
        console.error(`[WORKER DEBUG] Error processing ${file}:`, err);
      }
      processedCount++;
    }
  }

  // Send final results - Convert Maps to plain objects for serialization
  const result = {
    chunkId,
    exports: Object.fromEntries(exportMap),
    contents: Object.fromEntries(contents),
    processedCount
  };

  parentPort.postMessage({
    type: 'complete',
    result
  });
}
