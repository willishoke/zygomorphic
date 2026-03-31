import { describe, it, expect } from 'vitest';
import { initialState, reduce, AppState, AppEvent } from './state.js';
import type { NodeData, RootAnalysis, TreeData, LeafSchema } from './types.js';

// ---- Helpers ---------------------------------------------------------------

function leaf(id: string, problem = id): NodeData {
  return { id, problem, parent_id: null, children: [], is_leaf: false, depth: 0, plan: null, dependencies: [], schema: null };
}

function rootReviewState(): AppState {
  const analysis: RootAnalysis = { problem_statement: 'build a thing' };
  const rootNode = leaf('0', 'build a thing');
  const s0 = reduce(initialState(), { type: 'QUERY_SUBMITTED', rootNode });
  return reduce(s0, { type: 'ROOT_ANALYZED', problem: 'build a thing', analysis });
}

function traversingState(): AppState {
  const s0 = rootReviewState();
  const tree = s0.tree!;
  const s1 = reduce(s0, { type: 'ROOT_APPROVED', rootId: '0', tree });
  return reduce(s1, { type: 'TRAVERSAL_NODE_LOADING', nodeId: '0' });
}

// ---- QUERY_SUBMITTED -------------------------------------------------------

describe('QUERY_SUBMITTED', () => {
  it('sets loading and seeds the tree', () => {
    const rootNode = leaf('0', 'my query');
    const s = reduce(initialState(), { type: 'QUERY_SUBMITTED', rootNode });
    expect(s.loading).toBe(true);
    expect(s.screen.tag).toBe('input');
    expect(s.tree?.nodes['0']?.problem).toBe('my query');
  });

  it('resets prior state', () => {
    const s0 = rootReviewState();
    const rootNode = leaf('0', 'new query');
    const s1 = reduce(s0, { type: 'QUERY_SUBMITTED', rootNode });
    expect(s1.rootRef).toBeNull();
    expect(s1.error).toBeUndefined();
    expect(s1.buildProgress).toBeNull();
  });
});

// ---- ROOT_ANALYZED ---------------------------------------------------------

describe('ROOT_ANALYZED', () => {
  it('transitions to root_review and clears loading', () => {
    const rootNode = leaf('0', 'q');
    const s0 = reduce(initialState(), { type: 'QUERY_SUBMITTED', rootNode });
    const analysis: RootAnalysis = { problem_statement: 'q refined' };
    const s1 = reduce(s0, { type: 'ROOT_ANALYZED', problem: 'q', analysis });

    expect(s1.screen.tag).toBe('root_review');
    expect(s1.loading).toBe(false);
    expect(s1.rootRef).toEqual({ problem: 'q', analysis });
    if (s1.screen.tag === 'root_review') {
      expect(s1.screen.analysis).toBe(analysis);
    }
  });

  it('clears a prior error', () => {
    const s0: AppState = { ...initialState(), error: 'something went wrong' };
    const s1 = reduce(s0, { type: 'ROOT_ANALYZED', problem: 'q', analysis: {} });
    expect(s1.error).toBeUndefined();
  });
});

// ---- ROOT_APPROVED / traversal init ----------------------------------------

describe('ROOT_APPROVED', () => {
  it('seeds the traversal queue with the root id', () => {
    const s0 = rootReviewState();
    const s1 = reduce(s0, { type: 'ROOT_APPROVED', rootId: '0', tree: s0.tree! });
    expect(s1.traversalQueue).toEqual(['0']);
    expect(s1.traversalSeen).toBe(0);
  });

  it('restores a null tree from the event', () => {
    const s0: AppState = { ...rootReviewState(), tree: null };
    const freshTree: TreeData = { root_id: '0', nodes: { '0': leaf('0', 'q') } };
    const s1 = reduce(s0, { type: 'ROOT_APPROVED', rootId: '0', tree: freshTree });
    expect(s1.tree).toBe(freshTree);
  });
});

// ---- TRAVERSAL_NODE_LOADING ------------------------------------------------

describe('TRAVERSAL_NODE_LOADING', () => {
  it('shifts the queue, increments seen, sets loading', () => {
    const s0 = rootReviewState();
    const tree = s0.tree!;
    const s1 = reduce(s0, { type: 'ROOT_APPROVED', rootId: '0', tree });
    expect(s1.traversalQueue).toEqual(['0']);

    const s2 = reduce(s1, { type: 'TRAVERSAL_NODE_LOADING', nodeId: '0' });
    expect(s2.traversalQueue).toEqual([]);
    expect(s2.traversalSeen).toBe(1);
    expect(s2.loading).toBe(true);
    expect(s2.screen.tag).toBe('traversing');
    if (s2.screen.tag === 'traversing') {
      expect(s2.screen.currentId).toBe('0');
    }
  });
});

// ---- NODE_ASSESSED_LEAF / NODE_ASSESSED_BRANCH ----------------------------

describe('NODE_ASSESSED_LEAF', () => {
  it('sets traversal with leaf info and clears loading', () => {
    const s0 = traversingState();
    const schema: LeafSchema = { summary: 'do the thing', steps: ['step 1'] };
    const s1 = reduce(s0, {
      type: 'NODE_ASSESSED_LEAF',
      nodeId: '0', problem: 'build a thing', schema,
      queueLength: 0, totalSeen: 1,
    });
    expect(s1.loading).toBe(false);
    expect(s1.traversal?.isLeaf).toBe(true);
    expect(s1.traversal?.pendingSchema).toBe(schema);
    expect(s1.traversal?.nodeId).toBe('0');
  });
});

describe('NODE_ASSESSED_BRANCH', () => {
  it('sets traversal with branch info and clears loading', () => {
    const s0 = traversingState();
    const s1 = reduce(s0, {
      type: 'NODE_ASSESSED_BRANCH',
      nodeId: '0', problem: 'build a thing',
      subproblems: ['part A', 'part B'],
      queueLength: 0, totalSeen: 1,
    });
    expect(s1.loading).toBe(false);
    expect(s1.traversal?.isLeaf).toBe(false);
    expect(s1.traversal?.pendingSubproblems).toEqual(['part A', 'part B']);
  });
});

// ---- NODE_REFINED ----------------------------------------------------------

describe('NODE_REFINED', () => {
  it('updates pendingSchema for a leaf traversal', () => {
    const s0 = traversingState();
    const schema: LeafSchema = { summary: 'original' };
    const s1 = reduce(s0, {
      type: 'NODE_ASSESSED_LEAF', nodeId: '0', problem: 'p', schema,
      queueLength: 0, totalSeen: 1,
    });
    const refined: LeafSchema = { summary: 'refined' };
    const s2 = reduce(reduce(s1, { type: 'REFINE_NODE_STARTED' }), { type: 'NODE_REFINED', schema: refined });
    expect(s2.traversal?.pendingSchema).toBe(refined);
    expect(s2.loading).toBe(false);
  });

  it('updates pendingSubproblems for a branch traversal', () => {
    const s0 = traversingState();
    const s1 = reduce(s0, {
      type: 'NODE_ASSESSED_BRANCH', nodeId: '0', problem: 'p',
      subproblems: ['A', 'B'], queueLength: 0, totalSeen: 1,
    });
    const s2 = reduce(reduce(s1, { type: 'REFINE_NODE_STARTED' }), {
      type: 'NODE_REFINED', subproblems: ['A refined', 'B refined', 'C new'],
    });
    expect(s2.traversal?.pendingSubproblems).toEqual(['A refined', 'B refined', 'C new']);
  });

  it('is a no-op if there is no active traversal', () => {
    const s0 = rootReviewState();
    const s1 = reduce(s0, { type: 'NODE_REFINED', schema: { summary: 'x' } });
    expect(s1).toBe(s0);
  });
});

// ---- NODE_LEAF_COMMITTED ---------------------------------------------------

describe('NODE_LEAF_COMMITTED', () => {
  it('clears traversal and updates the tree', () => {
    const s0 = traversingState();
    const updatedTree: TreeData = {
      root_id: '0',
      nodes: { '0': { ...leaf('0', 'build a thing'), is_leaf: true } },
    };
    const s1 = reduce(s0, { type: 'NODE_LEAF_COMMITTED', updatedTree });
    expect(s1.traversal).toBeNull();
    expect(s1.tree).toBe(updatedTree);
  });
});

// ---- NODE_CHILDREN_ADDED ---------------------------------------------------

describe('NODE_CHILDREN_ADDED', () => {
  it('clears traversal, updates tree and queue', () => {
    const s0 = traversingState();
    const childA = leaf('1', 'part A');
    const childB = leaf('2', 'part B');
    const updatedTree: TreeData = {
      root_id: '0',
      nodes: { '0': { ...leaf('0'), children: ['1', '2'] }, '1': childA, '2': childB },
    };
    const s1 = reduce(s0, { type: 'NODE_CHILDREN_ADDED', updatedTree, updatedQueue: ['1', '2'] });
    expect(s1.traversal).toBeNull();
    expect(s1.tree).toBe(updatedTree);
    expect(s1.traversalQueue).toEqual(['1', '2']);
  });
});

// ---- TRAVERSAL_COMPLETE ----------------------------------------------------

describe('TRAVERSAL_COMPLETE', () => {
  it('transitions to explore and clears traversal state', () => {
    const s0 = traversingState();
    const s1 = reduce(s0, { type: 'TRAVERSAL_COMPLETE' });
    expect(s1.screen.tag).toBe('explore');
    expect(s1.traversal).toBeNull();
    expect(s1.traversalQueue).toEqual([]);
  });
});

// ---- BUILD events ----------------------------------------------------------

describe('BUILD_STARTED', () => {
  it('sets screen to building and initializes buildProgress', () => {
    const s0: AppState = { ...initialState(), screen: { tag: 'explore', tree: { root_id: '0', nodes: {} } } };
    const epochs = [{ nodes: [{ nodeId: '1', problem: 'p', status: 'waiting' as const }] }];
    const s1 = reduce(s0, { type: 'BUILD_STARTED', initialEpochs: epochs, git: false, outputDir: 'output' });
    expect(s1.screen.tag).toBe('building');
    expect(s1.buildProgress?.activeEpoch).toBe(-1);
    expect(s1.buildProgress?.done).toBe(false);
    expect(s1.buildProgress?.epochs).toBe(epochs);
  });
});

describe('BUILD_NODE_DONE', () => {
  it('patches only the targeted node', () => {
    const epochs = [{
      nodes: [
        { nodeId: 'a', problem: 'A', status: 'running' as const },
        { nodeId: 'b', problem: 'B', status: 'waiting' as const },
      ],
    }];
    const s0: AppState = {
      ...initialState(),
      screen: { tag: 'building' },
      buildProgress: { epochs, activeEpoch: 0, done: false },
    };
    const s1 = reduce(s0, {
      type: 'BUILD_NODE_DONE', nodeId: 'a', status: 'done', outputPath: 'output/a',
    });
    const nodes = s1.buildProgress!.epochs[0]!.nodes;
    expect(nodes[0]!.status).toBe('done');
    expect(nodes[0]!.outputPath).toBe('output/a');
    expect(nodes[1]!.status).toBe('waiting'); // untouched
  });
});

describe('BUILD_COMPLETE', () => {
  it('marks done and preserves fatalError', () => {
    const s0: AppState = {
      ...initialState(),
      screen: { tag: 'building' },
      buildProgress: { epochs: [], activeEpoch: 0, done: false },
    };
    const s1 = reduce(s0, { type: 'BUILD_COMPLETE', fatalError: 'oops' });
    expect(s1.buildProgress?.done).toBe(true);
    expect(s1.buildProgress?.fatalError).toBe('oops');
  });
});

// ---- BACK ------------------------------------------------------------------

describe('BACK', () => {
  it('root_review → input: full reset', () => {
    const s0 = rootReviewState();
    const s1 = reduce(s0, { type: 'BACK' });
    expect(s1.screen.tag).toBe('input');
    expect(s1.rootRef).toBeNull();
    expect(s1.tree).toBeNull();
  });

  it('traversing → root_review: resets tree and queue', () => {
    const s0 = traversingState();
    const s1 = reduce(s0, { type: 'BACK' });
    expect(s1.screen.tag).toBe('root_review');
    expect(s1.tree).toBeNull();
    expect(s1.traversalQueue).toEqual([]);
    expect(s1.traversal).toBeNull();
  });

  it('explore → root_review: keeps tree', () => {
    const tree: TreeData = { root_id: '0', nodes: { '0': leaf('0') } };
    const s0: AppState = {
      ...rootReviewState(),
      screen: { tag: 'explore', tree },
      tree,
    };
    const s1 = reduce(s0, { type: 'BACK' });
    expect(s1.screen.tag).toBe('root_review');
    expect(s1.tree).toBe(tree); // preserved
  });

  it('building → explore', () => {
    const tree: TreeData = { root_id: '0', nodes: { '0': leaf('0') } };
    const s0: AppState = {
      ...initialState(),
      screen: { tag: 'building' },
      tree,
      buildProgress: { epochs: [], activeEpoch: 0, done: false },
    };
    const s1 = reduce(s0, { type: 'BACK' });
    expect(s1.screen.tag).toBe('explore');
  });

  it('is a no-op from input', () => {
    const s0 = initialState();
    const s1 = reduce(s0, { type: 'BACK' });
    expect(s1).toEqual(s0);
  });
});

// ---- ERROR -----------------------------------------------------------------

describe('ERROR', () => {
  it('clears loading and sets the message', () => {
    const rootNode = leaf('0', 'q');
    const s0 = reduce(initialState(), { type: 'QUERY_SUBMITTED', rootNode });
    expect(s0.loading).toBe(true);
    const s1 = reduce(s0, { type: 'ERROR', message: 'api down' });
    expect(s1.loading).toBe(false);
    expect(s1.error).toBe('api down');
  });

  it('preserves the current screen', () => {
    const s0 = rootReviewState();
    const s1 = reduce(s0, { type: 'ERROR', message: 'nope' });
    expect(s1.screen.tag).toBe('root_review');
  });
});
