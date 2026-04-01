// ---- Graph data model ------------------------------------------------------

export interface ExplorationEntry {
  agent: string;
  timestamp: number;
  conclusion?: string;
}

export interface NodeData {
  id: string;
  content: string;
  summary: string;
  exploration: ExplorationEntry[];
  created_at: string;
  updated_at: string;
}

export interface Edge {
  id: string;
  a: string;
  b: string;
  label: string;
  created_at: string;
}

export interface Comment {
  id: string;
  node_id: string;
  content: string;
  author: string;
  created_at: string;
  expires_at: string | null;
}

export interface GraphData {
  nodes: Record<string, NodeData>;
  edges: Record<string, Edge>;
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
  focalComments: Comment[];
  navigationHistory: string[];
}
