import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { GraphData } from './types.js';

const now = new Date().toISOString();

function makeGraph(): GraphData {
  return {
    nodes: {
      root: {
        id: 'root', content: 'hello', summary: 'root node',
        exploration: [], created_at: now, updated_at: now,
      },
    },
    edges: {},
  };
}

describe('Orchestrator', () => {
  it('starts with empty state', () => {
    const orch = new Orchestrator();
    const state = orch.getState();
    expect(state.screen).toBe('empty');
    expect(state.loading).toBe(false);
    expect(state.error).toBeUndefined();
    expect(state.graph).toBeNull();
    expect(state.focusNodeId).toBeNull();
  });

  it('dispatch applies event and updates getState', async () => {
    const orch = new Orchestrator();
    const graph = makeGraph();
    await orch.dispatch({ type: 'GRAPH_LOADED', graph });
    const state = orch.getState();
    expect(state.screen).toBe('browse');
    expect(state.graph).toBe(graph);
    expect(state.focusNodeId).toBe('root');
  });

  it('emits a state event after dispatch', async () => {
    const orch = new Orchestrator();
    const emitted: unknown[] = [];
    orch.on('state', (s) => emitted.push(s));
    await orch.dispatch({ type: 'GRAPH_LOADED', graph: makeGraph() });
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as { screen: string }).screen).toBe('browse');
  });

  it('accumulates state across multiple dispatches', async () => {
    const orch = new Orchestrator();
    await orch.dispatch({ type: 'GRAPH_LOADED', graph: makeGraph() });
    await orch.dispatch({ type: 'FOCUS_CHANGED', nodeId: null });
    expect(orch.getState().focusNodeId).toBeNull();
    await orch.dispatch({ type: 'FOCUS_CHANGED', nodeId: 'root' });
    expect(orch.getState().focusNodeId).toBe('root');
  });

  it('getState shape matches WebState', () => {
    const orch = new Orchestrator();
    const state = orch.getState();
    expect(Object.keys(state).sort()).toEqual(
      ['error', 'focalComments', 'focusNodeId', 'graph', 'loading', 'navigationHistory', 'screen'].sort(),
    );
  });
});
