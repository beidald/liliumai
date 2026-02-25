import path from 'path';
import fs from 'fs';

// Robust Project Root Resolution Strategy
// 1. Start from current file location (__dirname) which is immutable
// 2. Traverse up until we find package.json
// This completely ignores process.cwd() which can be hijacked by native modules
function findProjectRoot(startPath: string): string {
  let currentDir = startPath;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  // Fallback to process.cwd() only if package.json not found (unlikely)
  return process.cwd();
}

// Cache the project root to avoid recalculation
const PROJECT_ROOT = findProjectRoot(__dirname);

export function getProjectRoot(): string {
  return PROJECT_ROOT;
}

export function resolvePath(...segments: string[]): string {
  return path.resolve(PROJECT_ROOT, ...segments);
}