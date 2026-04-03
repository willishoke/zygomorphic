import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { GraphData, WebState } from './types.js';

const DATA_FILE = process.env['ZYGOMORPHIC_DATA_FILE'] ?? 'graph.json';

export function loadGraph(): GraphData | null {
  if (!existsSync(DATA_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as GraphData;
  } catch {
    return null;
  }
}

export function persistOnMutation() {
  return (state: WebState) => {
    if (!state.graph) return;
    const dir = dirname(DATA_FILE);
    if (dir !== '.') mkdirSync(dir, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(state.graph, null, 2));
  };
}
