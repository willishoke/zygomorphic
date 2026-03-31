// ---- Graph data model ------------------------------------------------------

export interface Link {
  target: string;
  relation: string;
}

export interface ExplorationEntry {
  agent: string;
  timestamp: number;
  conclusion?: string;
}

export interface NodeData {
  id: string;
  content: string;
  summary: string;
  parent_ids: string[];
  children: string[];
  links: Link[];
  depth: number;
  exploration: ExplorationEntry[];
}

export interface GraphData {
  root_ids: string[];
  nodes: Record<string, NodeData>;
}

// ---- App state machine -----------------------------------------------------

export type AppScreen =
  | { tag: 'browse' }
  | { tag: 'empty' };

// ---- Web state (pushed over SSE) -------------------------------------------

export interface WebState {
  screen: string;
  loading: boolean;
  error?: string;
  graph: GraphData | null;
  focusNodeId: string | null;
}
