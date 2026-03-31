/**
 * Orchestrator: coordinates async work and dispatches events to the pure
 * reducer. All state lives in this.state; transitions are handled by
 * reduce(). Emits 'state' events with WebState for the web server.
 */
import { EventEmitter } from 'events';
import { LLMClient } from './llm.js';
import { WebState } from './types.js';
import { AppState, AppEvent, initialState, reduce } from './state.js';

// --------------------------------------------------------------------------

export class Orchestrator extends EventEmitter {
  llm = new LLMClient();
  private state: AppState = initialState();

  // ---- Dispatch & snapshot -------------------------------------------------

  dispatch(event: AppEvent): void {
    this.state = reduce(this.state, event);
    this.emit('state', this.getState());
  }

  getState(): WebState {
    const { screen, loading, error, tree } = this.state;

    return {
      screen: screen.tag,
      loading,
      error,
      tree,
      traversalNodeId: null,
      buildProgress: null,
    };
  }
}
