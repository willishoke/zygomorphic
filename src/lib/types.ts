export interface FieldDef {
  name: string;
  type: string;
  description?: string;
}

export interface DataStructureDef {
  name: string;
  fields?: FieldDef[];
}

export interface FunctionDef {
  name: string;
  signature: string;
  purpose: string;
}

export interface LeafSchema {
  summary?: string;
  estimated_lines?: number;
  data_structures?: DataStructureDef[];
  functions?: FunctionDef[];
  steps?: string[];
  edge_cases?: string[];
}

export interface NodeData {
  id: string;
  problem: string;
  parent_id: string | null;
  children: string[];
  is_leaf: boolean;
  depth: number;
  plan: string | null;
  dependencies: string[];
  schema: LeafSchema | null;
  subproblems?: string[];
}

export interface TreeData {
  root_id: string;
  nodes: Record<string, NodeData>;
}

export interface RootAnalysis {
  problem_statement?: string;
  key_components?: string[];
  scope_assessment?: string;
}

// ---- App state machine ----

export type AppScreen =
  | { tag: 'input' }
  | { tag: 'root_review'; problem: string; analysis: RootAnalysis }
  | { tag: 'traversing'; tree: TreeData; currentId: string; nodeMarkdown: string }
  | { tag: 'explore'; tree: TreeData }
  | { tag: 'building' };

// ---- Build progress (moved from BuildScreen.tsx) ----

export type NodeStatus = 'waiting' | 'running' | 'done' | 'error';

export interface NodeBuildStatus {
  nodeId: string;
  problem: string;
  status: NodeStatus;
  outputPath?: string;
  error?: string;
  branchName?: string;
  commitCount?: number;
  gitStep?: string;
}

export interface EpochInfo {
  nodes: NodeBuildStatus[];
}

export interface BuildProgress {
  epochs: EpochInfo[];
  activeEpoch: number; // 0-based, -1 = not started
  done: boolean;
  fatalError?: string;
  gitEnabled?: boolean;
  outputDir?: string;
}

// ---- Traversal state (for orchestrator → web) ----

export interface TraversalInfo {
  nodeId: string;
  problem: string;
  isLeaf: boolean;
  queueLength: number;
  totalSeen: number;
  pendingSchema?: LeafSchema;
  pendingSubproblems?: string[];
}

// ---- Web state (pushed over SSE) ----

export interface WebState {
  screen: string;
  loading: boolean;
  error?: string;
  tree: TreeData | null;
  traversalNodeId: string | null;
  buildProgress: BuildProgress | null;
  // root_review
  rootProblem?: string;
  rootAnalysis?: RootAnalysis;
  // traversing
  traversal?: TraversalInfo;
}
