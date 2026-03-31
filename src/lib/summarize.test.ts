import { describe, it, expect } from 'vitest';
import { propagateSummaries } from './summarize.js';
import type { GraphData, NodeData } from './types.js';
import { LLMClient } from './llm.js';

function makeNode(id: string, opts: Partial<NodeData> = {}): NodeData {
  return {
    id,
    content: opts.content ?? `content of ${id}`,
    summary: opts.summary ?? `summary of ${id}`,
    parent_ids: opts.parent_ids ?? [],
    children: opts.children ?? [],
    links: opts.links ?? [],
    depth: opts.depth ?? 0,
    exploration: opts.exploration ?? [],
  };
}

// Stub LLM that echoes a predictable summary
class StubLLM extends LLMClient {
  async call(prompt: string): Promise<string> {
    // Extract the node content from the prompt to make summaries deterministic
    const match = prompt.match(/Content:\n(.+?)\n/);
    const content = match?.[1] ?? 'unknown';
    return `summarized: ${content}`;
  }
}

describe('propagateSummaries', () => {
  it('generates summary for the target node', async () => {
    const graph: GraphData = {
      root_ids: ['a'],
      nodes: { a: makeNode('a', { content: 'hello world' }) },
    };

    const events = await propagateSummaries(new StubLLM(), 'a', graph);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('SUMMARY_UPDATED');
    if (events[0]!.type === 'SUMMARY_UPDATED') {
      expect(events[0]!.nodeId).toBe('a');
      expect(events[0]!.summary).toContain('summarized');
    }
  });

  it('propagates upward through parents', async () => {
    const graph: GraphData = {
      root_ids: ['root'],
      nodes: {
        root: makeNode('root', { children: ['child'], content: 'root content' }),
        child: makeNode('child', { parent_ids: ['root'], content: 'child content' }),
      },
    };

    const events = await propagateSummaries(new StubLLM(), 'child', graph);
    expect(events).toHaveLength(2);
    const nodeIds = events.map((e) => e.type === 'SUMMARY_UPDATED' ? e.nodeId : null);
    expect(nodeIds).toContain('child');
    expect(nodeIds).toContain('root');
  });

  it('handles multiple parents (DAG)', async () => {
    const graph: GraphData = {
      root_ids: ['p1', 'p2'],
      nodes: {
        p1: makeNode('p1', { children: ['child'], content: 'parent 1' }),
        p2: makeNode('p2', { children: ['child'], content: 'parent 2' }),
        child: makeNode('child', { parent_ids: ['p1', 'p2'], content: 'shared child' }),
      },
    };

    const events = await propagateSummaries(new StubLLM(), 'child', graph);
    expect(events).toHaveLength(3); // child, p1, p2
  });

  it('does not visit nodes twice', async () => {
    // Diamond: root → a → leaf, root → b → leaf
    const graph: GraphData = {
      root_ids: ['root'],
      nodes: {
        root: makeNode('root', { children: ['a', 'b'], content: 'root' }),
        a: makeNode('a', { parent_ids: ['root'], children: ['leaf'], content: 'a' }),
        b: makeNode('b', { parent_ids: ['root'], children: ['leaf'], content: 'b' }),
        leaf: makeNode('leaf', { parent_ids: ['a', 'b'], content: 'leaf' }),
      },
    };

    const events = await propagateSummaries(new StubLLM(), 'leaf', graph);
    const nodeIds = events.map((e) => e.type === 'SUMMARY_UPDATED' ? e.nodeId : null);
    // Each node should appear exactly once
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
  });

  it('returns empty for unknown node', async () => {
    const graph: GraphData = { root_ids: [], nodes: {} };
    const events = await propagateSummaries(new StubLLM(), 'ghost', graph);
    expect(events).toEqual([]);
  });
});
