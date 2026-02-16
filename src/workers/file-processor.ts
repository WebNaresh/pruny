import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IGNORED_EXPORT_NAMES, FRAMEWORK_METHOD_DECORATORS, NEST_LIFECYCLE_METHODS,
  JS_KEYWORDS, CLASS_METHOD_REGEX, INLINE_EXPORT_REGEX, BLOCK_EXPORT_REGEX,
  isServiceLikeFile,
} from '../constants.js';

interface WorkerData {
  files: string[];
  cwd: string;
  chunkId: number;
}

// Process files assigned to this worker
if (parentPort && workerData) {
  const { files, cwd, chunkId } = workerData as WorkerData;

  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const contents = new Map<string, string>();
  let processedCount = 0;

  // Fresh regex instances (stateful with /g flag)
  const classMethodRegex = new RegExp(CLASS_METHOD_REGEX.source, CLASS_METHOD_REGEX.flags);
  const inlineExportRegex = new RegExp(INLINE_EXPORT_REGEX.source, INLINE_EXPORT_REGEX.flags);
  const blockExportRegex = new RegExp(BLOCK_EXPORT_REGEX.source, BLOCK_EXPORT_REGEX.flags);

  for (const file of files) {
    try {
      const filePath = file.startsWith('/') ? file : join(cwd, file);
      const content = readFileSync(filePath, 'utf-8');
      contents.set(file, content);

      const lines = content.split('\n');
      const isService = isServiceLikeFile(file);

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

      } // End of line-by-line loop

      // 2. Class methods in services (Cascading fix)
      if (isService) {
        classMethodRegex.lastIndex = 0;
        let match;
        while ((match = classMethodRegex.exec(content)) !== null) {
          const name = match[1];
          if (name && !NEST_LIFECYCLE_METHODS.has(name) && !IGNORED_EXPORT_NAMES.has(name) && !JS_KEYWORDS.has(name)) {
            // Calculate line number from the NAME index
            const nameIndex = match.index + match[0].indexOf(name);
            const lineNum = content.substring(0, nameIndex).split('\n').length;

            if (process.env.DEBUG_PRUNY) {
              console.log(`[WORKER DEBUG] Found candidate method: ${name} in ${file} at line ${lineNum}`);
            }

            // Framework awareness: Check for decorators that imply framework usage
            let isFrameworkManaged = false;
            for (let k = 1; k <= 15; k++) {
              if (lineNum - 1 - k >= 0) {
                const prevLine = lines[lineNum - 1 - k].trim();
                if (prevLine.startsWith('@') && Array.from(FRAMEWORK_METHOD_DECORATORS).some(d => prevLine.startsWith(d))) {
                  isFrameworkManaged = true;
                  if (process.env.DEBUG_PRUNY) {
                    console.log(`[WORKER DEBUG] Method ${name} is framework managed by ${prevLine}`);
                  }
                  break;
                }
                if (prevLine.startsWith('export class') || prevLine.includes(' constructor(') || (prevLine.includes(') {') && !prevLine.startsWith('@') && !prevLine.endsWith(')'))) {
                  break;
                }
              }
            }

            if (isFrameworkManaged) continue;

            const existing = exportMap.get(file)?.find(e => e.name === name);
            if (!existing) {
              if (!exportMap.has(file)) exportMap.set(file, []);
              exportMap.get(file)!.push({ name, line: lineNum, file });
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
