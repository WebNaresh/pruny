import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { Config, UnusedExport } from '../types.js';

// Next.js/React standard exports that shouldn't be marked as unused
const IGNORED_EXPORT_NAMES = new Set([
  'config',
  'generateMetadata',
  'generateStaticParams',
  'dynamic',
  'revalidate',
  'fetchCache',
  'runtime',
  'preferredRegion',
  'metadata',
  'viewport',
  'dynamicParams',
  'maxDuration',
  'generateViewport',
  'generateSitemaps',
  'generateImageMetadata',
  'alt',
  'size',
  'contentType',
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', // Handled by API scanner
  'default'
]);

const NEST_LIFECYCLE_METHODS = new Set(['constructor', 'onModuleInit', 'onApplicationBootstrap', 'onModuleDestroy', 'beforeApplicationShutdown', 'onApplicationShutdown']);
const classMethodRegex = /^\s*(?:async\s+)?([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^\{]*)?\{/gm;
const inlineExportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|type|interface|enum|class)\s+([a-zA-Z0-9_$]+)/gm;
const blockExportRegex = /^export\s*\{([^}]+)\}/gm;

/**
 * Process files in parallel using worker threads
 */
async function processFilesInParallel(
  files: string[],
  cwd: string,
  workerCount: number
): Promise<{
  exportMap: Map<string, { name: string; line: number; file: string }[]>;
  contents: Map<string, string>;
}> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Worker is compiled to dist/workers/file-processor.js
  const workerPath = join(__dirname, 'workers/file-processor.js');
  
  // Split files into chunks for each worker
  const chunkSize = Math.ceil(files.length / workerCount);
  const chunks: string[][] = [];
  for (let i = 0; i < workerCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, files.length);
    if (start < files.length) {
      chunks.push(files.slice(start, end));
    }
  }
  
  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const contents = new Map<string, string>();
  const progressMap = new Map<number, { processed: number; total: number }>();
  
  // Create workers
  const workerPromises = chunks.map((chunk, chunkId) => {
    return new Promise<void>((resolve, reject) => {
      const worker = new Worker(workerPath, {
        workerData: {
          files: chunk,
          cwd,
          chunkId
        }
      });
      
      worker.on('message', (msg) => {
        if (msg.type === 'progress') {
          // Update progress for this worker
          progressMap.set(msg.chunkId, {
            processed: msg.processed,
            total: msg.total
          });
          
          // Calculate total progress
          let totalProcessed = 0;
          let totalFiles = 0;
          for (const [, progress] of progressMap.entries()) {
            totalProcessed += progress.processed;
            totalFiles += progress.total;
          }
          
          const percent = Math.round((totalProcessed / totalFiles) * 100);
          process.stdout.write(`\r   Progress: ${totalProcessed}/${totalFiles} (${percent}%)...${' '.repeat(10)}`);
        } else if (msg.type === 'complete') {
          // Merge results
          const result = msg.result;
          
          // Convert plain objects back to Maps
          const workerExportMap = new Map(Object.entries(result.exports));
          const workerContents = new Map(Object.entries(result.contents));
          
          for (const [file, exports] of workerExportMap.entries()) {
            exportMap.set(file, exports as { name: string; line: number; file: string }[]);
          }
          
          for (const [file, content] of workerContents.entries()) {
            contents.set(file, content as string);
          }
          
          worker.terminate();
          resolve();
        }
      });
      
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  });
  
  await Promise.all(workerPromises);
  
  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  
  return { exportMap, contents };
}

/**
 * Scan for unused named exports within source files
 */
export async function scanUnusedExports(config: Config): Promise<{ total: number; used: number; unused: number; exports: UnusedExport[] }> {
  const cwd = config.dir;
  const extensions = config.extensions;
  const extGlob = `**/*{${extensions.join(',')}}`;

  // 1. Determine Scope
  // Candidates: Files we want to find unused exports IN (e.g., apps/web)
  const candidateCwd = config.appSpecificScan ? config.appSpecificScan.appDir : cwd;
  
  // References: Files we want to check for USAGE in (Global / Root)
  const referenceCwd = config.appSpecificScan ? config.appSpecificScan.rootDir : cwd;

  console.log(`\n   🔍 Finding export candidates in: ${candidateCwd}`);
  console.log(`   🌍 Checking usage in global scope: ${referenceCwd}\n`);

  // 2. Find Candidate Files (to scan for exports)
  const candidateFiles = await fg(extGlob, {
    cwd: candidateCwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
    absolute: true // Get absolute paths to match easily
  });

  if (candidateFiles.length === 0) {
    return { total: 0, used: 0, unused: 0, exports: [] };
  }

  // 3. Find Reference Files (to check for usage)
  // We need to read ALL files to check if they use our candidates
  const referenceFiles = await fg(extGlob, {
    cwd: referenceCwd,
    ignore: [...config.ignore.folders, ...config.ignore.files],
    absolute: true
  });

  const exportMap = new Map<string, { name: string; line: number; file: string }[]>();
  const totalContents = new Map<string, string>();
  let allExportsCount = 0;

  // Patterns to find exports
  const inlineExportRegex = /^export\s+(?:async\s+)?(?:const|let|var|function|type|interface|enum|class)\s+([a-zA-Z0-9_$]+)/gm;
  const blockExportRegex = /^export\s*\{([^}]+)\}/gm;

  // Use parallel processing for large projects (500+ files)
  const USE_WORKERS = referenceFiles.length >= 500;
  const WORKER_COUNT = 2; // Gentle on CPU - only 2 workers

  if (USE_WORKERS) {
    console.log(`📝 Scanning ${candidateFiles.length} candidate files for exports & ${referenceFiles.length} files for usage...`);
    
    // Process ALL reference files (superset) so we have contents for usage check
    // We only care about exports from candidateFiles, but we need contents of everything.
    const result = await processFilesInParallel(referenceFiles, referenceCwd, WORKER_COUNT);
    
    // Merge file contents (Global)
    for (const [file, content] of result.contents.entries()) {
      totalContents.set(file, content);
    }

    // Merge results from workers, BUT only keep exports if they are in candidateFiles
    const candidateSet = new Set(candidateFiles);
    
    for (const [file, exports] of result.exportMap.entries()) {
      // Worker returns absolute paths or relatives? processFilesInParallel uses cwd
      // Let's ensure we are matching correctly.
      // If processFilesInParallel passed absolute paths, it returns absolute keys.
      
      const absoluteFile = file.startsWith('/') ? file : join(referenceCwd, file);
      
      if (candidateSet.has(absoluteFile)) {
         // Fix relative path for display/reporting relative to project root (or app root?)
         // The types expect relative paths usually.
         const displayPath = relative(config.dir, absoluteFile); // Relative to execution root
         
         const mappedExports = exports.map(e => ({...e, file: displayPath}));
         exportMap.set(displayPath, mappedExports);
         allExportsCount += mappedExports.length;
      }
    }
    
  } else {
  console.log(`📝 Scanning ${candidateFiles.length} files for exports...`);
  
  // We need to read ALL reference files to build totalContents
  for (const file of referenceFiles) {
      try {
          const content = readFileSync(file, 'utf-8');
          totalContents.set(file, content);
      } catch {}
  }

  let processedFiles = 0;
  
  // Only scan candidates for EXPORTS
  for (const file of candidateFiles) {
    try {
      processedFiles++;
      
      // Relative path for reporting
      const displayPath = relative(config.dir, file); 

      // Show progress every 10 files
      if (processedFiles % 10 === 0 || processedFiles === candidateFiles.length) {
        const percent = Math.round((processedFiles / candidateFiles.length) * 100);
        process.stdout.write(`\r   Progress: ${processedFiles}/${candidateFiles.length} (${percent}%)`);
      }
      
      const content = totalContents.get(file) || readFileSync(file, 'utf-8');
      totalContents.set(file, content);

      const isService = file.endsWith('.service.ts') || file.endsWith('.service.tsx');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 1. Regular exports
        inlineExportRegex.lastIndex = 0;
        let match;
        while ((match = inlineExportRegex.exec(line)) !== null) {
          if (addExport(displayPath, match[1], i + 1)) {
            allExportsCount++;
          }
        }

        blockExportRegex.lastIndex = 0;
        while ((match = blockExportRegex.exec(line)) !== null) {
          const names = match[1].split(',').map((n: string) => {
             const parts = n.trim().split(/\s+as\s+/);
             return parts[parts.length - 1];
          });
          for (const name of names) {
            if (addExport(displayPath, name, i + 1)) {
              allExportsCount++;
            }
          }
        }

        // 2. Class methods in services (Cascading fix)
        if (isService) {
          classMethodRegex.lastIndex = 0;
          while ((match = classMethodRegex.exec(line)) !== null) {
            const name = match[1];
            if (name && !NEST_LIFECYCLE_METHODS.has(name) && !IGNORED_EXPORT_NAMES.has(name)) {
              // Ensure it looks like a method declaration (not a call) 
              // and isn't already added (e.g. if it has 'export' prefix we caught it above)
              const existing = exportMap.get(displayPath)?.find(e => e.name === name);
              if (!existing) {
                if (addExport(displayPath, name, i + 1)) {
                  allExportsCount++;
                }
              }
            }
          }
        }
      }
    } catch {
      // Skip unreadable
    }
  }
  
  // Clear progress line
  if (processedFiles > 0) {
    process.stdout.write('\r' + ' '.repeat(60) + '\r');
  }
  } // Close else block


  function addExport(file: string, name: string, line: number): boolean {
    if (name && !IGNORED_EXPORT_NAMES.has(name)) {
      if (!exportMap.has(file)) exportMap.set(file, []);
      exportMap.get(file)!.push({ name, line, file });
      return true;
    }
    return false;
  }

  const unusedExports: UnusedExport[] = [];
  
  console.log(`🔍 Checking usage of ${allExportsCount} exports...`);

  // 3. Check for references in all files
  for (const [file, exports] of exportMap.entries()) {
    for (const exp of exports) {
      let isUsed = false;
      let usedInternally = false;

      // First check internal usage (within the same file)
      const fileContent = totalContents.get(file);
      if (fileContent) {
        const lines = fileContent.split('\n');
        let fileInMultilineComment = false;
        let fileInTemplateLiteral = false;

        for (let i = 0; i < lines.length; i++) {
          if (i === exp.line - 1) continue; // Skip the declaration line
          
          const line = lines[i];
          const trimmed = line.trim();
          
          // Track multi-line comment state
          if (trimmed.includes('/*')) fileInMultilineComment = true;
          if (trimmed.includes('*/')) {
            fileInMultilineComment = false;
            continue;
          }
          if (fileInMultilineComment) continue;

          // Track template literal state
          const backtickCount = (line.match(/`/g) || []).length;
          if (backtickCount % 2 !== 0) {
            fileInTemplateLiteral = !fileInTemplateLiteral;
          }
          if (fileInTemplateLiteral) continue;

          // Skip single-line comments
          if (trimmed.startsWith('//')) continue;
          
          // Skip text inside single or double quotes
          const lineWithoutStrings = line
            .replace(/'[^']*'/g, "''")
            .replace(/"[^"]*"/g, '""');

          // Check for actual usage with code-like context
          const referenceRegex = new RegExp(`\\b${exp.name}\\b`);
          if (referenceRegex.test(lineWithoutStrings)) {
            // Verify it's in code context (added <, >, |, &)
            const codePattern = new RegExp(`\\b${exp.name}\\s*[({.,;<>|&)]|\\b${exp.name}\\s*\\)|\\s+${exp.name}\\b`);
            if (codePattern.test(lineWithoutStrings)) {
              usedInternally = true;
              break;
            }
          }
        }
      }

      // Then check external usage (in other files)
      for (const [otherFile, content] of totalContents.entries()) {
        if (file === otherFile) continue;

        // Fast path: Check for common usage patterns first (most performant)
        // JSX usage: <ExportName
        const jsxPattern = new RegExp(`<${exp.name}[\\s/>]`);
        if (jsxPattern.test(content)) {
          isUsed = true;
          break;
        }
        
        // Import usage: import { ExportName } from
        const importPattern = new RegExp(`import.*\\b${exp.name}\\b.*from`);
        if (importPattern.test(content)) {
          isUsed = true;
          break;
        }
        
        // For other potential usage, use word boundary check but exclude obvious false positives
        const wordBoundaryPattern = new RegExp(`\\b${exp.name}\\b`);
        if (wordBoundaryPattern.test(content)) {
          // Found potential match - verify it's in actual code, not strings/comments
          const lines = content.split('\n');
          let inMultilineComment = false;
          let inTemplateLiteral = false;
          
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmed = line.trim();
            
            // Track multi-line comment state
            if (trimmed.includes('/*')) inMultilineComment = true;
            if (trimmed.includes('*/')) {
              inMultilineComment = false;
              continue;
            }
            if (inMultilineComment) continue;
            
            // Track template literal state (multi-line strings with backticks)
            const backtickCount = (line.match(/`/g) || []).length;
            if (backtickCount % 2 !== 0) {
              inTemplateLiteral = !inTemplateLiteral;
            }
            if (inTemplateLiteral) continue;
            
            // Skip single-line comments
            if (trimmed.startsWith('//')) continue;
            
            // Skip text inside single or double quotes (simple check)
            // Replace strings with placeholders to avoid matching words inside them
            const lineWithoutStrings = line
              .replace(/'[^']*'/g, "''")
              .replace(/"[^"]*"/g, '""');

            // Simple check: if line contains the export name AND looks like code
            // (has code-like patterns: function calls, property access, generics, etc.)
            if (wordBoundaryPattern.test(lineWithoutStrings)) {
              // Added <, >, |, & for TypeScript types and generics
              const codePattern = new RegExp(`\\b${exp.name}\\s*[({.,;<>|&)]|\\b${exp.name}\\s*\\)|\\s+${exp.name}\\b`);
              const isMatch = codePattern.test(lineWithoutStrings);
              
              if (isMatch) {
                isUsed = true;
                break;
              }
            }
          }
        }
        
        if (isUsed) break;
      }

      if (!isUsed) {
        unusedExports.push({ ...exp, usedInternally });
      }
    }
  }

  return {
    total: allExportsCount,
    used: allExportsCount - unusedExports.length,
    unused: unusedExports.length,
    exports: unusedExports
  };
}

/**
 * Check if a line is a comment or within a string literal
 */
function isCommentOrString(line: string): boolean {
  const trimmed = line.trim();
  
  // Single-line comments
  if (trimmed.startsWith('//')) return true;
  
  // Multi-line comment start
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  
  // JSX/HTML comments
  if (trimmed.includes('{/*') || trimmed.includes('*/}')) return true;
  
  return false;
}
