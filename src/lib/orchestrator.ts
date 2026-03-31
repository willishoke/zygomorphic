/**
 * Orchestrator: coordinates async work (LLM calls, builder) and dispatches
 * events to the pure reducer. All state lives in this.state; transitions are
 * handled by reduce(). Emits 'state' events with WebState for the web server.
 */
import { EventEmitter } from 'events';
import { LLMClient } from './llm.js';
import { NodeData, TreeData, WebState, TraversalInfo } from './types.js';
import { buildTree } from './builder.js';
import { epochs } from './scheduler.js';
import { AppState, AppEvent, initialState, reduce } from './state.js';

// --------------------------------------------------------------------------

let _counter = 1;
function nextId(): string { return String(_counter++); }

function makeNode(id: string, problem: string, parentId: string | null, depth: number): NodeData {
  return { id, problem, parent_id: parentId, children: [], is_leaf: false, depth, plan: null, dependencies: [], schema: null };
}

// --------------------------------------------------------------------------

export class Orchestrator extends EventEmitter {
  private llm = new LLMClient();
  private state: AppState = initialState();

  // ---- Dispatch & snapshot -------------------------------------------------

  private dispatch(event: AppEvent): void {
    this.state = reduce(this.state, event);
    this.emit('state', this.getState());
  }

  getState(): WebState {
    const { screen, loading, error, tree, traversal, buildProgress } = this.state;

    const base: WebState = {
      screen: screen.tag,
      loading,
      error,
      tree,
      traversalNodeId: traversal?.nodeId ?? null,
      buildProgress,
    };

    if (screen.tag === 'root_review') {
      return { ...base, rootProblem: screen.problem, rootAnalysis: screen.analysis };
    }

    if (screen.tag === 'traversing' && traversal) {
      return {
        ...base,
        traversal: {
          nodeId: traversal.nodeId,
          problem: traversal.problem,
          isLeaf: traversal.isLeaf,
          queueLength: traversal.queueLength,
          totalSeen: traversal.totalSeen,
          pendingSchema: traversal.pendingSchema,
          pendingSubproblems: traversal.pendingSubproblems,
        } satisfies TraversalInfo,
      };
    }

    return base;
  }

  // ---- Public actions ------------------------------------------------------

  async submitQuery(query: string): Promise<void> {
    _counter = 1;
    const rootNode = makeNode('0', query, null, 0);
    this.dispatch({ type: 'QUERY_SUBMITTED', rootNode });
    try {
      const analysis = await this.llm.analyzeRoot(query);
      this.dispatch({ type: 'ROOT_ANALYZED', problem: query, analysis });
    } catch (e) {
      this.dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async approveRoot(): Promise<void> {
    _counter = 1;
    // Tree may be null if the user went back from traversing then re-approved.
    // Reconstruct it from rootRef in that case.
    let tree = this.state.tree;
    if (!tree) {
      const problem = this.state.rootRef?.problem ?? '';
      const rootNode = makeNode('0', problem, null, 0);
      tree = { root_id: '0', nodes: { '0': rootNode } };
    }
    this.dispatch({ type: 'ROOT_APPROVED', rootId: tree.root_id, tree });
    await this.advanceTraversal();
  }

  async refineRoot(feedback: string): Promise<void> {
    const { screen } = this.state;
    if (screen.tag !== 'root_review') return;
    this.dispatch({ type: 'REFINE_ROOT_STARTED' });
    try {
      const analysis = await this.llm.analyzeRoot(`${screen.problem}\n\nUser refinement: ${feedback}`);
      this.dispatch({ type: 'ROOT_ANALYZED', problem: screen.problem, analysis });
    } catch (e) {
      this.dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async approveNode(): Promise<void> {
    const { traversal, tree } = this.state;
    if (!traversal || !tree) return;
    const { nodeId, isLeaf, pendingSchema, pendingSubproblems } = traversal;
    const node = tree.nodes[nodeId]!;

    if (isLeaf) {
      const updatedTree: TreeData = {
        ...tree,
        nodes: { ...tree.nodes, [nodeId]: { ...node, is_leaf: true, schema: pendingSchema ?? null } },
      };
      this.dispatch({ type: 'NODE_LEAF_COMMITTED', updatedTree });
    } else {
      const subs = pendingSubproblems ?? [];
      let deps: Record<string, number[]> = {};
      if (subs.length > 1) {
        try { deps = await this.llm.identifyDeps(subs); } catch { /* skip — deps are optional */ }
      }

      // Build new child nodes and an updated parent
      const newNodes: typeof tree.nodes = { ...tree.nodes };
      const childIds: string[] = [];
      const updatedChildren: string[] = [];

      for (const sp of subs) {
        const childId = nextId();
        const child = makeNode(childId, sp, nodeId, node.depth + 1);
        child.dependencies = [...node.dependencies];
        newNodes[childId] = child;
        updatedChildren.push(childId);
        childIds.push(childId);
      }
      newNodes[nodeId] = { ...node, children: updatedChildren };

      // Apply inter-sibling deps returned by identifyDeps
      for (const [idxStr, depIdxs] of Object.entries(deps)) {
        const idx = parseInt(idxStr);
        const childId = childIds[idx];
        if (!childId) continue;
        const existing = newNodes[childId]!.dependencies;
        const merged = [...existing];
        for (const depIdx of depIdxs) {
          const depId = childIds[depIdx];
          if (depId && !merged.includes(depId)) merged.push(depId);
        }
        newNodes[childId] = { ...newNodes[childId]!, dependencies: merged };
      }

      const updatedTree: TreeData = { ...tree, nodes: newNodes };
      const updatedQueue = [...this.state.traversalQueue, ...childIds];
      this.dispatch({ type: 'NODE_CHILDREN_ADDED', updatedTree, updatedQueue });
    }

    await this.advanceTraversal();
  }

  async refineNode(feedback: string): Promise<void> {
    const { traversal } = this.state;
    if (!traversal) return;
    const { isLeaf, pendingSchema, pendingSubproblems, problem } = traversal;
    this.dispatch({ type: 'REFINE_NODE_STARTED' });
    try {
      if (isLeaf) {
        const schema = await this.llm.refinePlan(problem, pendingSchema!, feedback);
        this.dispatch({ type: 'NODE_REFINED', schema });
      } else {
        const subproblems = await this.llm.refineDecompose(problem, pendingSubproblems!, feedback);
        this.dispatch({ type: 'NODE_REFINED', subproblems });
      }
    } catch (e) {
      this.dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    }
  }

  startBuild(git: boolean): void {
    const { tree } = this.state;
    if (!tree) return;
    const outputDir = 'output';
    const schedule = epochs(tree.nodes);
    const initialEpochs = schedule.map((nodeIds) => ({
      nodes: nodeIds.map((id) => ({
        nodeId: id,
        problem: tree.nodes[id]?.problem ?? id,
        status: 'waiting' as const,
      })),
    }));
    this.dispatch({ type: 'BUILD_STARTED', initialEpochs, git, outputDir });

    buildTree(tree.nodes, this.llm, {
      outputDir,
      git,
      onGitError:    (err)           => this.dispatch({ type: 'BUILD_GIT_ERROR', error: err }),
      onEpochStart:  (epochIdx)      => this.dispatch({ type: 'BUILD_EPOCH_STARTED', epochIdx: epochIdx - 1 }),
      onNodeStart:   (nodeId)        => this.dispatch({ type: 'BUILD_NODE_STARTED', nodeId }),
      onNodeGitStep: (nodeId, step)  => this.dispatch({ type: 'BUILD_NODE_GIT_STEP', nodeId, step }),
      onNodeCommit:  (nodeId, count) => this.dispatch({ type: 'BUILD_NODE_COMMIT', nodeId, commitCount: count }),
      onNodeDone:    (result)        => this.dispatch({
        type: 'BUILD_NODE_DONE',
        nodeId: result.nodeId,
        status: result.error ? 'error' : 'done',
        outputPath: result.outputPath,
        error: result.error,
        branchName: result.branchName,
        commitCount: result.commitCount,
      }),
    })
      .then(() => this.dispatch({ type: 'BUILD_COMPLETE' }))
      .catch((e) => this.dispatch({ type: 'BUILD_COMPLETE', fatalError: e instanceof Error ? e.message : String(e) }));
  }

  back(): void {
    this.dispatch({ type: 'BACK' });
  }

  // ---- Internal ------------------------------------------------------------

  private async advanceTraversal(): Promise<void> {
    const { traversalQueue, tree } = this.state;

    if (traversalQueue.length === 0) {
      this.dispatch({ type: 'TRAVERSAL_COMPLETE' });
      return;
    }

    const nodeId = traversalQueue[0];
    const node = tree!.nodes[nodeId]!;
    this.dispatch({ type: 'TRAVERSAL_NODE_LOADING', nodeId });

    // Capture progress counts from the post-dispatch state (queue has been shifted)
    const { traversalSeen: totalSeen, traversalQueue: remaining } = this.state;
    const queueLength = remaining.length;

    try {
      const isLeaf = await this.llm.assess(node.problem);

      if (isLeaf) {
        const schema = await this.llm.structuredPlan(node.problem);
        this.dispatch({ type: 'NODE_ASSESSED_LEAF', nodeId, problem: node.problem, schema, queueLength, totalSeen });
      } else {
        const parentProblem = node.parent_id ? tree!.nodes[node.parent_id]?.problem ?? '' : '';
        const subproblems = await this.llm.decompose(node.problem, parentProblem);
        this.dispatch({ type: 'NODE_ASSESSED_BRANCH', nodeId, problem: node.problem, subproblems, queueLength, totalSeen });
      }
    } catch (e) {
      this.dispatch({ type: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    }
  }
}
