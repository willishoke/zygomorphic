/**
 * Pure state machine for the app.
 * AppState is the single state shape; AppEvent is the exhaustive event union.
 * reduce(state, event) → state has no side effects and is fully unit-testable.
 */

import {
  AppScreen, GraphData, NodeData, Link, ExplorationEntry,
} from './types.js';

// ---- State ----------------------------------------------------------------

export interface AppState {
  screen: AppScreen;
  loading: boolean;
  error: string | undefined;
  graph: GraphData | null;
  focusNodeId: string | null;
}

export function initialState(): AppState {
  return {
    screen: { tag: 'empty' },
    loading: false,
    error: undefined,
    graph: null,
    focusNodeId: null,
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
  // Links
  | { type: 'LINK_CREATED'; fromId: string; link: Link }
  | { type: 'LINK_DELETED'; fromId: string; targetId: string; relation: string }
  // Structure
  | { type: 'NODE_RESTRUCTURED'; nodeId: string; oldParentId: string; newParentId: string }
  // Summary propagation
  | { type: 'SUMMARY_UPDATED'; nodeId: string; summary: string }
  // Exploration
  | { type: 'EXPLORATION_UPDATED'; nodeId: string; entry: ExplorationEntry }
  // Navigation
  | { type: 'FOCUS_CHANGED'; nodeId: string | null }
  // Cross-cutting
  | { type: 'ERROR'; message: string };

// ---- Reducer --------------------------------------------------------------

export function reduce(state: AppState, event: AppEvent): AppState {
  switch (event.type) {

    case 'GRAPH_LOADED':
      return {
        ...state,
        graph: event.graph,
        screen: { tag: 'browse' },
        focusNodeId: event.graph.root_ids[0] ?? null,
      };

    case 'NODE_CREATED': {
      if (!state.graph) return state;
      const node = event.node;
      const nodes = { ...state.graph.nodes, [node.id]: node };

      // Add as child of each parent
      for (const pid of node.parent_ids) {
        const parent = nodes[pid];
        if (parent && !parent.children.includes(node.id)) {
          nodes[pid] = { ...parent, children: [...parent.children, node.id] };
        }
      }

      // If no parents, this is a root
      const root_ids = node.parent_ids.length === 0
        ? [...state.graph.root_ids, node.id]
        : state.graph.root_ids;

      return {
        ...state,
        graph: { ...state.graph, nodes, root_ids },
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
            [event.nodeId]: { ...existing, content: event.content, summary: event.summary },
          },
        },
      };
    }

    case 'NODE_DELETED': {
      if (!state.graph) return state;
      const target = state.graph.nodes[event.nodeId];
      if (!target) return state;

      const nodes = { ...state.graph.nodes };
      delete nodes[event.nodeId];

      // Remove from parents' children lists
      for (const pid of target.parent_ids) {
        const parent = nodes[pid];
        if (parent) {
          nodes[pid] = { ...parent, children: parent.children.filter((c) => c !== event.nodeId) };
        }
      }

      // Remove from root_ids if it was a root
      const root_ids = state.graph.root_ids.filter((id) => id !== event.nodeId);

      // Clear focus if deleted node was focused
      const focusNodeId = state.focusNodeId === event.nodeId ? null : state.focusNodeId;

      return {
        ...state,
        graph: { ...state.graph, nodes, root_ids },
        focusNodeId,
      };
    }

    case 'LINK_CREATED': {
      if (!state.graph) return state;
      const from = state.graph.nodes[event.fromId];
      if (!from) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [event.fromId]: { ...from, links: [...from.links, event.link] },
          },
        },
      };
    }

    case 'LINK_DELETED': {
      if (!state.graph) return state;
      const from = state.graph.nodes[event.fromId];
      if (!from) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [event.fromId]: {
              ...from,
              links: from.links.filter(
                (l) => !(l.target === event.targetId && l.relation === event.relation),
              ),
            },
          },
        },
      };
    }

    case 'NODE_RESTRUCTURED': {
      if (!state.graph) return state;
      const node = state.graph.nodes[event.nodeId];
      const oldParent = state.graph.nodes[event.oldParentId];
      const newParent = state.graph.nodes[event.newParentId];
      if (!node || !oldParent || !newParent) return state;

      const nodes = { ...state.graph.nodes };

      // Update node's parent_ids
      nodes[event.nodeId] = {
        ...node,
        parent_ids: node.parent_ids
          .filter((pid) => pid !== event.oldParentId)
          .concat(event.newParentId),
      };

      // Remove from old parent's children
      nodes[event.oldParentId] = {
        ...oldParent,
        children: oldParent.children.filter((c) => c !== event.nodeId),
      };

      // Add to new parent's children
      if (!newParent.children.includes(event.nodeId)) {
        nodes[event.newParentId] = {
          ...newParent,
          children: [...newParent.children, event.nodeId],
        };
      }

      return { ...state, graph: { ...state.graph, nodes } };
    }

    case 'SUMMARY_UPDATED': {
      if (!state.graph) return state;
      const existing = state.graph.nodes[event.nodeId];
      if (!existing) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: {
            ...state.graph.nodes,
            [event.nodeId]: { ...existing, summary: event.summary },
          },
        },
      };
    }

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

    case 'FOCUS_CHANGED':
      return { ...state, focusNodeId: event.nodeId };

    case 'ERROR':
      return { ...state, loading: false, error: event.message };
  }
}
