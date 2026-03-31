/**
 * Summary propagation: when a node changes, regenerate its summary
 * and propagate upward through ancestors.
 */
import { LLMClient } from './llm.js';
import type { GraphData, NodeData } from './types.js';
import type { AppEvent } from './state.js';

const SUMMARY_PROMPT = `Summarize the following content in 1-2 sentences. The summary should be sufficient for someone to decide whether this content is relevant to their query without reading the full text. Be specific and informative, not generic.

Content:
{content}

{children_context}

Respond with ONLY the summary text, no quotes or labels.`;

/**
 * Generate a summary for a single node, considering its content and
 * children's summaries.
 */
export async function generateSummary(
  llm: LLMClient,
  node: NodeData,
  graph: GraphData,
): Promise<string> {
  let childrenContext = '';
  if (node.children.length > 0) {
    const childSummaries = node.children
      .map((cid) => graph.nodes[cid])
      .filter(Boolean)
      .map((c) => `- ${c!.summary}`)
      .join('\n');
    childrenContext = `This node has the following children:\n${childSummaries}`;
  }

  const prompt = SUMMARY_PROMPT
    .replace('{content}', node.content)
    .replace('{children_context}', childrenContext);

  return llm.call(prompt);
}

/**
 * Propagate summary updates upward from a given node through all ancestors.
 * Returns a list of events to dispatch.
 */
export async function propagateSummaries(
  llm: LLMClient,
  startNodeId: string,
  graph: GraphData,
): Promise<AppEvent[]> {
  const events: AppEvent[] = [];
  const visited = new Set<string>();

  // Start with the changed node, then walk up to ancestors
  const queue = [startNodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = graph.nodes[nodeId];
    if (!node) continue;

    const summary = await generateSummary(llm, node, graph);
    events.push({ type: 'SUMMARY_UPDATED', nodeId, summary });

    // Enqueue parents for propagation
    for (const pid of node.parent_ids) {
      if (!visited.has(pid)) {
        queue.push(pid);
      }
    }
  }

  return events;
}

/**
 * Create a propagation hook for the orchestrator.
 * When attached, it auto-propagates summaries on node create/update.
 */
export function createPropagationHook(
  llm: LLMClient,
  getGraph: () => GraphData | null,
  dispatch: (event: AppEvent) => void,
): (event: AppEvent) => void {
  return (event: AppEvent) => {
    let targetId: string | null = null;

    if (event.type === 'NODE_CREATED') {
      targetId = event.node.id;
    } else if (event.type === 'NODE_UPDATED') {
      targetId = event.nodeId;
    }

    if (!targetId) return;

    const graph = getGraph();
    if (!graph) return;

    // Fire-and-forget: propagation runs in background
    propagateSummaries(llm, targetId, graph)
      .then((events) => {
        for (const e of events) dispatch(e);
      })
      .catch((err) => {
        console.error('Summary propagation failed:', err);
      });
  };
}
