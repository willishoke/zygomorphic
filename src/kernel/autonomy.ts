/**
 * autonomy.ts — Autonomy model for factoring decisions.
 *
 * Autonomy annotates the factoring 2-cell, not the morphism itself:
 *   auto:    agent factors and proceeds
 *   approve: agent proposes, human reviews before factoring takes effect
 *   manual:  human draws the split
 *
 * Human feedback is a typed response:
 *   Approved:      factoring proceeds as proposed
 *   Rejected:      factoring is denied with reason
 *   Edited:        factoring is modified (human tweaks the split)
 *   Restructured:  human provides an entirely different factoring
 *
 * Escalation: an agent in `auto` whose trace isn't converging promotes
 * itself to `approve`. Autonomy is a floor, not a ceiling.
 */

import type { Autonomy } from './types.js';
import type { Rewrite } from './rewrite.js';
import { checkRewrite } from './rewrite.js';

// --- Human feedback type ---

export type HumanFeedback =
  | { decision: 'approved' }
  | { decision: 'rejected'; reason: string }
  | { decision: 'edited'; modified: Rewrite }
  | { decision: 'restructured'; alternative: Rewrite }

// --- Approve gate ---

/**
 * An approve gate blocks signal propagation until a human acts.
 * The gate holds a proposed rewrite and waits for feedback.
 */
export interface ApproveGate {
  /** The proposed rewrite awaiting approval. */
  proposed: Rewrite;
  /** Current autonomy level. */
  autonomy: Autonomy;
  /** Feedback received (null if pending). */
  feedback: HumanFeedback | null;
}

/** Create a gate for a proposed rewrite. */
export function createGate(proposed: Rewrite, autonomy: Autonomy): ApproveGate {
  return { proposed, autonomy, feedback: null };
}

/**
 * Resolve a gate with human feedback.
 * Returns the rewrite to apply, or null if rejected.
 *
 * - approved: apply the original proposed rewrite
 * - rejected: no rewrite applied (returns null)
 * - edited: apply the modified rewrite (type-checked)
 * - restructured: apply the alternative rewrite (type-checked)
 */
export function resolveGate(
  gate: ApproveGate,
  feedback: HumanFeedback,
): Rewrite | null {
  gate.feedback = feedback;

  switch (feedback.decision) {
    case 'approved':
      return gate.proposed;

    case 'rejected':
      return null;

    case 'edited':
      // Type-check the modified rewrite preserves boundaries
      checkRewrite(feedback.modified);
      return feedback.modified;

    case 'restructured':
      // Type-check the alternative rewrite preserves boundaries
      checkRewrite(feedback.alternative);
      return feedback.alternative;
  }
}

// --- Escalation ---

/**
 * Check if an autonomy level should escalate.
 *
 * An agent in `auto` whose trace isn't converging promotes to `approve`.
 * Returns the escalated autonomy level.
 */
export function escalate(
  current: Autonomy,
  traceIterations: number,
  maxBeforeEscalation: number,
): Autonomy {
  if (current === 'auto' && traceIterations >= maxBeforeEscalation) {
    return 'approve';
  }
  return current;
}

/**
 * Whether a rewrite at the given autonomy level can proceed without
 * human intervention.
 */
export function canProceed(autonomy: Autonomy): boolean {
  return autonomy === 'auto';
}

/**
 * Whether a rewrite requires human input before it can be applied.
 */
export function requiresHuman(autonomy: Autonomy): boolean {
  return autonomy === 'approve' || autonomy === 'manual';
}
