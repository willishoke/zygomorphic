/**
 * Persistence layer: durable graph storage via atomic JSON file writes.
 *
 * Writes use temp-file-and-rename for crash safety. The graph is a single
 * serializable object; this is sufficient for single-machine use.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { GraphData } from './types.js';

const DEFAULT_DIR = path.join(os.homedir(), '.zygomorphic');
const DEFAULT_FILE = 'graph.json';

export interface PersistenceOptions {
  dir?: string;
  filename?: string;
}

function resolvedPath(opts: PersistenceOptions = {}): string {
  const dir = opts.dir ?? DEFAULT_DIR;
  const filename = opts.filename ?? DEFAULT_FILE;
  return path.join(dir, filename);
}

/** Load a graph from disk. Returns null if the file doesn't exist. */
export function loadGraph(opts: PersistenceOptions = {}): GraphData | null {
  const filePath = resolvedPath(opts);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GraphData;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') return null;
    throw new Error(`Failed to load graph from ${filePath}: ${err.message}`);
  }
}

/** Save a graph to disk atomically (write to temp file, then rename). */
export function saveGraph(graph: GraphData, opts: PersistenceOptions = {}): void {
  const filePath = resolvedPath(opts);
  const dir = path.dirname(filePath);

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  // Atomic write: temp file in same directory, then rename
  const tmpPath = filePath + `.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(graph, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    // Clean up temp file on failure
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    throw e;
  }
}

/**
 * Create a persistence hook that auto-saves on every state mutation.
 * Attach to an orchestrator: `orch.on('state', persistOnMutation(opts))`
 */
export function persistOnMutation(opts: PersistenceOptions = {}): (state: { graph?: GraphData | null }) => void {
  return (state) => {
    if (state.graph) {
      saveGraph(state.graph, opts);
    }
  };
}
