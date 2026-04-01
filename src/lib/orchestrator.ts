/**
 * Orchestrator: coordinates async work and dispatches events to the pure
 * reducer. All state lives in this.state; transitions are handled by
 * reduce(). Emits 'state' events with WebState for the web server.
 *
 * Write events are persisted to Postgres after the reducer runs.
 */
import { EventEmitter } from 'events';
import { WebState, Comment } from './types.js';
import { AppState, AppEvent, initialState, reduce } from './state.js';
import * as db from './db.js';

export class Orchestrator extends EventEmitter {
  private state: AppState = initialState();

  async dispatch(event: AppEvent): Promise<void> {
    this.state = reduce(this.state, event);
    await this.persist(event);

    // Load comments when focus changes
    if (
      (event.type === 'NAVIGATION_PUSH' || event.type === 'FOCUS_CHANGED')
      && this.state.focusNodeId
    ) {
      const comments = await db.getComments(this.state.focusNodeId);
      this.state = reduce(this.state, { type: 'COMMENTS_LOADED', comments });
    }

    this.emit('state', this.getState());
  }

  async reload(): Promise<void> {
    const prevFocus = this.state.focusNodeId;
    const prevHistory = this.state.navigationHistory;
    const graph = await db.loadFullGraph();
    this.state = reduce(this.state, { type: 'GRAPH_LOADED', graph });

    // Restore focus if the node still exists
    if (prevFocus && graph.nodes[prevFocus]) {
      this.state = { ...this.state, focusNodeId: prevFocus, navigationHistory: prevHistory };
    }

    if (this.state.focusNodeId) {
      const comments = await db.getComments(this.state.focusNodeId);
      this.state = reduce(this.state, { type: 'COMMENTS_LOADED', comments });
    }

    this.emit('state', this.getState());
  }

  async reloadComments(): Promise<void> {
    if (!this.state.focusNodeId) return;
    const comments = await db.getComments(this.state.focusNodeId);
    this.state = reduce(this.state, { type: 'COMMENTS_LOADED', comments });
    this.emit('state', this.getState());
  }

  getState(): WebState {
    const { screen, loading, error, graph, focusNodeId, focalComments, navigationHistory } = this.state;
    return {
      screen: screen.tag,
      loading,
      error,
      graph,
      focusNodeId,
      focalComments,
      navigationHistory,
    };
  }

  private async persist(event: AppEvent): Promise<void> {
    try {
      switch (event.type) {
        case 'NODE_CREATED':
          await db.insertNode(event.node);
          break;
        case 'NODE_UPDATED':
          await db.updateNode(event.nodeId, event.content, event.summary);
          break;
        case 'NODE_DELETED':
          await db.deleteNode(event.nodeId);
          break;
        case 'EDGE_CREATED':
          await db.insertEdge(event.edge);
          break;
        case 'EDGE_DELETED':
          await db.deleteEdge(event.edgeId);
          break;
        case 'COMMENT_ADDED':
          await db.insertComment(event.comment);
          break;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state = reduce(this.state, { type: 'ERROR', message: `DB error: ${message}` });
    }
  }
}
