import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadGraph, saveGraph, persistOnMutation } from './persistence.js';
import type { GraphData } from './types.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zygo-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const testGraph: GraphData = {
  root_ids: ['r'],
  nodes: {
    r: {
      id: 'r', content: 'root', summary: 'the root', parent_ids: [],
      children: [], links: [], depth: 0, exploration: [],
    },
  },
};

describe('loadGraph', () => {
  it('returns null when file does not exist', () => {
    expect(loadGraph({ dir: tmpDir })).toBeNull();
  });

  it('loads a saved graph', () => {
    fs.writeFileSync(path.join(tmpDir, 'graph.json'), JSON.stringify(testGraph));
    const loaded = loadGraph({ dir: tmpDir });
    expect(loaded).toEqual(testGraph);
  });
});

describe('saveGraph', () => {
  it('creates directory and file', () => {
    const subDir = path.join(tmpDir, 'nested', 'dir');
    saveGraph(testGraph, { dir: subDir });
    const loaded = loadGraph({ dir: subDir });
    expect(loaded).toEqual(testGraph);
  });

  it('overwrites existing file', () => {
    saveGraph(testGraph, { dir: tmpDir });
    const updated = { ...testGraph, root_ids: ['r', 'r2'] };
    saveGraph(updated, { dir: tmpDir });
    expect(loadGraph({ dir: tmpDir })?.root_ids).toEqual(['r', 'r2']);
  });
});

describe('persistOnMutation', () => {
  it('saves graph when state has a graph', () => {
    const hook = persistOnMutation({ dir: tmpDir });
    hook({ graph: testGraph });
    expect(loadGraph({ dir: tmpDir })).toEqual(testGraph);
  });

  it('does nothing when graph is null', () => {
    const hook = persistOnMutation({ dir: tmpDir });
    hook({ graph: null });
    expect(loadGraph({ dir: tmpDir })).toBeNull();
  });
});
