/**
 * Pure state machine for the app.
 * AppState is the single state shape; AppEvent is the exhaustive event union.
 * reduce(state, event) → state has no side effects and is fully unit-testable.
 */

import {
  AppScreen, GraphData, NodeData, Edge, Comment, ExplorationEntry,
} from './types.js';

// ---- State ----------------------------------------------------------------

export interface AppState {
  screen: AppScreen;
  loading: boolean;
  error: string | undefined;
  graph: GraphData | null;
  focusNodeId: string | null;
  focalComments: Comment[];
  navigationHistory: string[];
}

export function initialState(): AppState {
  return {
    screen: { tag: 'empty' },
    loading: false,
    error: undefined,
    graph: null,
    focusNodeId: null,
    focalComments: [],
    navigationHistory: [],
  };
}

// ---- Events ---------------------------------------------------------------

export type AppEvent =
  // Graph lifecycle
  | { type: 'GRAPH_LOADED'; graph: GraphData }
  // Node CRUD
  | { type: 'NODE_CREATED'; node: NodeData }
  | { type: 'NODE_UPDATED'; nodeId: string; content: string; summary: string }
  | { type: 'NODE_DELETED'; nodeId: string }
  // Edges
  | { type: 'EDGE_CREATED'; edge: Edge }
  | { type: 'EDGE_DELETED'; edgeId: string }
  // Comments
  | { type: 'COMMENTS_LOADED'; comments: Comment[] }
  | { type: 'COMMENT_ADDED'; comment: Comment }
  // Exploration
  | { type: 'EXPLORATION_UPDATED'; nodeId: string; entry: ExplorationEntry }
  // Navigation
  | { type: 'NAVIGATION_PUSH'; nodeId: string }
  | { type: 'NAVIGATION_BACK' }
  | { type: 'FOCUS_CHANGED'; nodeId: string | null }
  // Cross-cutting
  | { type: 'ERROR'; message: string };

// ---- Reducer --------------------------------------------------------------

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {

    case 'GRAPH_LOADED': {
      const nodeIds = Object.keys(event.graph.nodes);
      return {
        ...state,
        graph: event.graph,
        screen: { tag: 'browse' },
        focusNodeId: nodeIds[0] ?? null,
      };
    }

    case 'NODE_CREATED': {
      if (!state.graph) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: { ...state.graph.nodes, [event.node.id]: event.node },
        },
        screen: { tag: 'browse' },
      };
    }

    case 'NODE_UPDATED': {
      if (!state.graph) return state;
      const existing = state.graph.nodes[event.nodeId];
      if (!existing) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [event.nodeId]: {
              ...existing,
              content: event.content,
              summary: event.summary,
              updated_at: new Date().toISOString(),
            },
          },
        },
      };
    }

    case 'NODE_DELETED': {
      if (!state.graph) return state;
      if (!state.graph.nodes[event.nodeId]) return state;

      const nodes = { ...state.graph.nodes };
      delete nodes[event.nodeId];

      // Remove all edges referencing this node
      const edges = { ...state.graph.edges };
      for (const [eid, edge] of Object.entries(edges)) {
        if (edge.a === event.nodeId || edge.b === event.nodeId) {
          delete edges[eid];
        }
      }

      const focusNodeId = state.focusNodeId === event.nodeId ? null : state.focusNodeId;
      const navigationHistory = state.navigationHistory.filter((id) => id !== event.nodeId);

      return {
        ...state,
        graph: { ...state.graph, nodes, edges },
        focusNodeId,
        navigationHistory,
      };
    }

    case 'EDGE_CREATED': {
      if (!state.graph) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          edges: { ...state.graph.edges, [event.edge.id]: event.edge },
        },
      };
    }

    case 'EDGE_DELETED': {
      if (!state.graph) return state;
      const edges = { ...state.graph.edges };
      delete edges[event.edgeId];
      return {
        ...state,
        graph: { ...state.graph, edges },
      };
    }

    case 'COMMENTS_LOADED':
      return { ...state, focalComments: event.comments };

    case 'COMMENT_ADDED':
      return { ...state, focalComments: [...state.focalComments, event.comment] };

    case 'EXPLORATION_UPDATED': {
      if (!state.graph) return state;
      const existing = state.graph.nodes[event.nodeId];
      if (!existing) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [event.nodeId]: {
              ...existing,
              exploration: [...existing.exploration, event.entry],
            },
          },
        },
      };
    }

    case 'NAVIGATION_PUSH':
      return {
        ...state,
        focusNodeId: event.nodeId,
        navigationHistory: [...state.navigationHistory, event.nodeId],
      };

    case 'NAVIGATION_BACK': {
      if (state.navigationHistory.length <= 1) return state;
      const history = state.navigationHistory.slice(0, -1);
      return {
        ...state,
        focusNodeId: history[history.length - 1] ?? null,
        navigationHistory: history,
      };
    }

    case 'FOCUS_CHANGED':
      return { ...state, focusNodeId: event.nodeId };

    case 'ERROR':
      return { ...state, loading: false, error: event.message };
  }
}
