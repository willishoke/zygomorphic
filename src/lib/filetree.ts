/**
 * Walk a workspace directory and return all file/directory paths,
 * respecting common ignore patterns.
 *
 * Returns paths relative to workspaceRoot, using forward slashes.
 */
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from './store.js';

const DEFAULT_IGNORE = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  '.cache',
  STORE_DIR,
]);

export interface FilePath {
  path: string;   // relative to workspaceRoot, forward-slash separated
  isLeaf: boolean;
}

export function walkTree(workspaceRoot: string, ignore = DEFAULT_IGNORE): FilePath[] {
  const results: FilePath[] = [];

  function walk(absDir: string, relDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (ignore.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;

      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        results.push({ path: relPath, isLeaf: false });
        walk(path.join(absDir, entry.name), relPath);
      } else if (entry.isFile()) {
        results.push({ path: relPath, isLeaf: true });
      }
    }
  }

  walk(workspaceRoot, '');
  return results;
}

/**
 * Ensure the .zygomorphic/ mirror structure exists for all paths.
 * Creates empty .md files for any node that doesn't yet have one.
 */
export function ensureMirror(workspaceRoot: string, paths: FilePath[]): void {
  const storeRoot = path.join(workspaceRoot, STORE_DIR);
  fs.mkdirSync(storeRoot, { recursive: true });

  const now = new Date().toISOString();
  const emptyMd = `---\ncreated_at: ${now}\nupdated_at: ${now}\n---\n\n`;

  // Root dir node
  const rootMd = path.join(storeRoot, '_dir.md');
  if (!fs.existsSync(rootMd)) fs.writeFileSync(rootMd, emptyMd);

  for (const { path: p, isLeaf } of paths) {
    const mdRel = isLeaf ? `${p}.md` : `${p}/_dir.md`;
    const mdAbs = path.join(storeRoot, mdRel);
    if (!fs.existsSync(mdAbs)) {
      fs.mkdirSync(path.dirname(mdAbs), { recursive: true });
      fs.writeFileSync(mdAbs, emptyMd);
    }
  }
}
