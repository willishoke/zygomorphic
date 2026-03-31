/**
 * Pure state machine for the app.
 * AppState is the single state shape; AppEvent is the exhaustive event union.
 * reduce(state, event) → state has no side effects and is fully unit-testable.
 */

import {
  AppScreen, TreeData, TraversalInfo, BuildProgress,
  RootAnalysis, LeafSchema, NodeData, EpochInfo, NodeBuildStatus,
} from './types.js';

// ---- State ----------------------------------------------------------------

export interface AppState {
  screen: AppScreen;
  loading: boolean;
  error: string | undefined;
  rootRef: { problem: string; analysis: RootAnalysis } | null;
  tree: TreeData | null;
  traversalQueue: string[];
  traversalSeen: number;
  traversal: TraversalInfo | null;
  buildProgress: BuildProgress | null;
}

export function initialState(): AppState {
  return {
    screen: { tag: 'input' },
    loading: false,
    error: undefined,
    rootRef: null,
    tree: null,
    traversalQueue: [],
    traversalSeen: 0,
    traversal: null,
    buildProgress: null,
  };
}

// ---- Events ---------------------------------------------------------------
// Async operations fire two events: one on initiation (sets loading) and one
// on completion (clears loading, updates state). This keeps the reducer as
// the single place where state shape changes are defined.

export type AppEvent =
  // Initiations
  | { type: 'QUERY_SUBMITTED'; rootNode: NodeData }
  | { type: 'REFINE_ROOT_STARTED' }
  | { type: 'ROOT_APPROVED'; rootId: string; tree: TreeData }
  | { type: 'TRAVERSAL_NODE_LOADING'; nodeId: string }
  | { type: 'REFINE_NODE_STARTED' }
  // Async completions
  | { type: 'ROOT_ANALYZED'; problem: string; analysis: RootAnalysis }
  | { type: 'NODE_ASSESSED_LEAF'; nodeId: string; problem: string; schema: LeafSchema; queueLength: number; totalSeen: number }
  | { type: 'NODE_ASSESSED_BRANCH'; nodeId: string; problem: string; subproblems: string[]; queueLength: number; totalSeen: number }
  | { type: 'NODE_REFINED'; schema?: LeafSchema; subproblems?: string[] }
  | { type: 'NODE_LEAF_COMMITTED'; updatedTree: TreeData }
  | { type: 'NODE_CHILDREN_ADDED'; updatedTree: TreeData; updatedQueue: string[] }
  | { type: 'TRAVERSAL_COMPLETE' }
  // Build progress
  | { type: 'BUILD_STARTED'; initialEpochs: EpochInfo[]; git: boolean; outputDir: string }
  | { type: 'BUILD_EPOCH_STARTED'; epochIdx: number }
  | { type: 'BUILD_NODE_STARTED'; nodeId: string }
  | { type: 'BUILD_NODE_GIT_STEP'; nodeId: string; step: string }
  | { type: 'BUILD_NODE_COMMIT'; nodeId: string; commitCount: number }
  | { type: 'BUILD_NODE_DONE'; nodeId: string; status: 'done' | 'error'; outputPath?: string; error?: string; branchName?: string; commitCount?: number }
  | { type: 'BUILD_GIT_ERROR'; error: string }
  | { type: 'BUILD_COMPLETE'; fatalError?: string }
  // Navigation & cross-cutting
  | { type: 'BACK' }
  | { type: 'ERROR'; message: string };

// ---- Reducer --------------------------------------------------------------

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {

    case 'QUERY_SUBMITTED':
      return {
        ...initialState(),
        loading: true,
        tree: { root_id: event.rootNode.id, nodes: { [event.rootNode.id]: event.rootNode } },
      };

    case 'ROOT_ANALYZED':
      return {
        ...state,
        loading: false,
        error: undefined,
        rootRef: { problem: event.problem, analysis: event.analysis },
        screen: { tag: 'root_review', problem: event.problem, analysis: event.analysis },
      };

    case 'REFINE_ROOT_STARTED':
      return { ...state, loading: true };

    case 'ROOT_APPROVED':
      return {
        ...state,
        tree: event.tree,
        traversalQueue: [event.rootId],
        traversalSeen: 0,
      };

    case 'TRAVERSAL_NODE_LOADING':
      return {
        ...state,
        loading: true,
        traversalQueue: state.traversalQueue.slice(1),
        traversalSeen: state.traversalSeen + 1,
        screen: { tag: 'traversing', tree: state.tree!, currentId: event.nodeId, nodeMarkdown: '' },
      };

    case 'NODE_ASSESSED_LEAF':
      return {
        ...state,
        loading: false,
        traversal: {
          nodeId: event.nodeId,
          problem: event.problem,
          isLeaf: true,
          queueLength: event.queueLength,
          totalSeen: event.totalSeen,
          pendingSchema: event.schema,
        },
      };

    case 'NODE_ASSESSED_BRANCH':
      return {
        ...state,
        loading: false,
        traversal: {
          nodeId: event.nodeId,
          problem: event.problem,
          isLeaf: false,
          queueLength: event.queueLength,
          totalSeen: event.totalSeen,
          pendingSubproblems: event.subproblems,
        },
      };

    case 'REFINE_NODE_STARTED':
      return { ...state, loading: true };

    case 'NODE_REFINED': {
      if (!state.traversal) return state;
      return {
        ...state,
        loading: false,
        traversal: {
          ...state.traversal,
          ...(event.schema !== undefined ? { pendingSchema: event.schema } : {}),
          ...(event.subproblems !== undefined ? { pendingSubproblems: event.subproblems } : {}),
        },
      };
    }

    case 'NODE_LEAF_COMMITTED':
      return { ...state, traversal: null, tree: event.updatedTree };

    case 'NODE_CHILDREN_ADDED':
      return {
        ...state,
        traversal: null,
        tree: event.updatedTree,
        traversalQueue: event.updatedQueue,
      };

    case 'TRAVERSAL_COMPLETE':
      return {
        ...state,
        traversal: null,
        traversalQueue: [],
        screen: { tag: 'explore', tree: { ...state.tree! } },
      };

    case 'BUILD_STARTED':
      return {
        ...state,
        screen: { tag: 'building' },
        buildProgress: {
          epochs: event.initialEpochs,
          activeEpoch: -1,
          done: false,
          gitEnabled: event.git,
          outputDir: event.outputDir,
        },
      };

    case 'BUILD_EPOCH_STARTED':
      if (!state.buildProgress) return state;
      return { ...state, buildProgress: { ...state.buildProgress, activeEpoch: event.epochIdx } };

    case 'BUILD_NODE_STARTED':
    case 'BUILD_NODE_GIT_STEP':
    case 'BUILD_NODE_COMMIT':
    case 'BUILD_NODE_DONE':
      if (!state.buildProgress) return state;
      return { ...state, buildProgress: patchBuildNode(state.buildProgress, event) };

    case 'BUILD_GIT_ERROR':
      if (!state.buildProgress) return state;
      return {
        ...state,
        buildProgress: { ...state.buildProgress, fatalError: `git init failed: ${event.error}`, gitEnabled: false },
      };

    case 'BUILD_COMPLETE':
      if (!state.buildProgress) return state;
      return { ...state, buildProgress: { ...state.buildProgress, done: true, fatalError: event.fatalError } };

    case 'BACK': {
      const { screen, rootRef, tree } = state;
      switch (screen.tag) {
        case 'root_review':
          return initialState();
        case 'traversing':
          if (!rootRef) return state;
          return {
            ...state,
            tree: null,
            traversalQueue: [],
            traversalSeen: 0,
            traversal: null,
            screen: { tag: 'root_review', problem: rootRef.problem, analysis: rootRef.analysis },
          };
        case 'explore':
          if (!rootRef) return state;
          return { ...state, screen: { tag: 'root_review', problem: rootRef.problem, analysis: rootRef.analysis } };
        case 'building':
          if (!tree) return state;
          return { ...state, screen: { tag: 'explore', tree: { ...tree } } };
        default:
          return state;
      }
    }

    case 'ERROR':
      return { ...state, loading: false, error: event.message };
  }
}

// ---- Helpers --------------------------------------------------------------

type BuildNodeEvent = Extract<AppEvent,
  { type: 'BUILD_NODE_STARTED' | 'BUILD_NODE_GIT_STEP' | 'BUILD_NODE_COMMIT' | 'BUILD_NODE_DONE' }>;

function patchBuildNode(progress: BuildProgress, event: BuildNodeEvent): BuildProgress {
  const patch = (nodeId: string, update: Partial<NodeBuildStatus>): BuildProgress => ({
    ...progress,
    epochs: progress.epochs.map((e) => ({
      ...e,
      nodes: e.nodes.map((n) => n.nodeId === nodeId ? { ...n, ...update } : n),
    })),
  });

  switch (event.type) {
    case 'BUILD_NODE_STARTED':  return patch(event.nodeId, { status: 'running' });
    case 'BUILD_NODE_GIT_STEP': return patch(event.nodeId, { gitStep: event.step });
    case 'BUILD_NODE_COMMIT':   return patch(event.nodeId, { commitCount: event.commitCount });
    case 'BUILD_NODE_DONE':     return patch(event.nodeId, {
      status: event.status,
      outputPath: event.outputPath,
      error: event.error,
      branchName: event.branchName,
      commitCount: event.commitCount,
      gitStep: undefined,
    });
  }
}
