/**
 * Executes leaf nodes in topological epoch order.
 * Within each epoch, tasks run in parallel (capped by maxWorkers).
 *
 * When opts.git is true, each node gets its own git branch (via worktree)
 * and the implementation is streamed with periodic WIP commits.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import type { NodeData, LeafSchema } from './types.js';
import { LLMClient } from './llm.js';
import { epochs } from './scheduler.js';
import {
  GitContext,
  initLocalRepo,
  createWorktree,
  stageAndCommit,
  removeWorktree,
  branchSlug,
} from './git.js';

export interface BuildResult {
  nodeId: string;
  outputPath: string;
  error?: string;
  // git (only present when git mode is active)
  branchName?: string;
  commitCount?: number;
}

export interface BuildOptions {
  outputDir?: string;
  maxWorkers?: number;
  git?: boolean;
  onGitInit?: (outputDir: string) => void;
  onGitError?: (error: string) => void;
  onEpochStart?: (epochIdx: number, total: number, size: number) => void;
  onNodeStart?: (nodeId: string) => void;
  onNodeGitStep?: (nodeId: string, step: string) => void;
  onNodeCommit?: (nodeId: string, commitCount: number) => void;
  onNodeDone?: (result: BuildResult) => void;
}

export async function buildTree(
  nodes: Record<string, NodeData>,
  llm: LLMClient,
  opts: BuildOptions = {},
): Promise<BuildResult[]> {
  const {
    outputDir = 'output',
    maxWorkers = 4,
    git = false,
    onGitInit,
    onGitError,
    onEpochStart,
    onNodeStart,
    onNodeGitStep,
    onNodeCommit,
    onNodeDone,
  } = opts;

  await mkdir(outputDir, { recursive: true });

  // initialise git repo if requested
  let gitCtx: GitContext | undefined;
  if (git) {
    try {
      const rootProblem = findRootProblem(nodes);
      gitCtx = await initLocalRepo(outputDir, rootProblem);
      onGitInit?.(outputDir);
    } catch (e) {
      onGitError?.(String(e));
      // continue without git
    }
  }

  const schedule = epochs(nodes);
  const results: BuildResult[] = [];

  for (let ei = 0; ei < schedule.length; ei++) {
    const epoch = schedule[ei]!;
    onEpochStart?.(ei + 1, schedule.length, epoch.length);

    for (let i = 0; i < epoch.length; i += maxWorkers) {
      const chunk = epoch.slice(i, i + maxWorkers);
      const chunkResults = await Promise.all(chunk.map((nodeId) => {
        onNodeStart?.(nodeId);
        return gitCtx
          ? buildNodeGit(nodeId, nodes[nodeId]!, llm, outputDir, gitCtx, {
              onGitStep: (s) => onNodeGitStep?.(nodeId, s),
              onCommit: (n) => onNodeCommit?.(nodeId, n),
            })
          : buildNode(nodeId, nodes[nodeId]!, llm, outputDir);
      }));
      for (const r of chunkResults) {
        results.push(r);
        onNodeDone?.(r);
      }
    }
  }

  // write manifest
  const manifest: Record<string, { problem: string; output: string }> = {};
  for (const r of results) {
    if (!r.error) manifest[r.nodeId] = { problem: nodes[r.nodeId]!.problem, output: r.outputPath };
  }
  await writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return results;
}

// ---------------------------------------------------------------------------
// Plain build (no git)
// ---------------------------------------------------------------------------

async function buildNode(
  nodeId: string,
  node: NodeData,
  llm: LLMClient,
  outputDir: string,
): Promise<BuildResult> {
  try {
    const code = await llm.implement(node.problem, (node.schema ?? {}) as LeafSchema);
    const filename = fileSlug(node.problem) + '.py';
    const outputPath = path.join(outputDir, filename);
    await writeFile(outputPath, code, 'utf8');
    return { nodeId, outputPath };
  } catch (e) {
    return { nodeId, outputPath: '', error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Git build — per-node branch + streaming commits
// ---------------------------------------------------------------------------

async function buildNodeGit(
  nodeId: string,
  node: NodeData,
  llm: LLMClient,
  outputDir: string,
  ctx: GitContext,
  callbacks: { onGitStep: (s: string) => void; onCommit: (n: number) => void },
): Promise<BuildResult> {
  const filename = fileSlug(node.problem) + '.py';
  const branch = `node/${nodeId}-${branchSlug(node.problem, 32)}`;
  let worktreeDir: string | undefined;

  try {
    // --- branch ---
    callbacks.onGitStep('branching…');
    worktreeDir = await createWorktree(ctx, branch);

    // --- scaffold commit ---
    callbacks.onGitStep('scaffolding…');
    const scaffold = buildScaffold(node);
    await stageAndCommit(worktreeDir, filename, scaffold, `scaffold: ${node.problem.slice(0, 60)}`);
    let commitCount = 1;
    callbacks.onCommit(commitCount);

    // --- stream implementation with periodic WIP commits ---
    callbacks.onGitStep('generating…');
    let accumulated = '';
    let lastCommitLen = 0;

    const flush = async () => {
      if (accumulated.length > lastCommitLen + 120) {
        const lines = accumulated.split('\n').length;
        await stageAndCommit(worktreeDir!, filename, accumulated, `wip: ${lines} lines`);
        commitCount++;
        lastCommitLen = accumulated.length;
        callbacks.onCommit(commitCount);
      }
    };

    // commit every 8 s while generating
    const timer = setInterval(() => { flush().catch(() => {}); }, 8_000);
    try {
      for await (const chunk of llm.implementStream(node.problem, (node.schema ?? {}) as LeafSchema)) {
        accumulated += chunk;
      }
    } finally {
      clearInterval(timer);
    }

    // --- final commit ---
    const lines = accumulated.split('\n').length;
    await stageAndCommit(worktreeDir, filename, accumulated, `feat: implement (${lines} lines)`);
    commitCount++;
    callbacks.onCommit(commitCount);

    // --- clean up worktree; write file to main output dir for manifest ---
    await removeWorktree(ctx, worktreeDir);
    worktreeDir = undefined;
    const outputPath = path.join(outputDir, filename);
    await (await import('fs/promises')).writeFile(outputPath, accumulated, 'utf8');

    return { nodeId, outputPath, branchName: branch, commitCount };

  } catch (e) {
    if (worktreeDir) await removeWorktree(ctx, worktreeDir).catch(() => {});
    return { nodeId, outputPath: '', error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileSlug(text: string, max = 48): string {
  return text.toLowerCase().slice(0, max).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'module';
}

function findRootProblem(nodes: Record<string, NodeData>): string {
  return Object.values(nodes).find((n) => n.parent_id === null)?.problem ?? 'project';
}

function buildScaffold(node: NodeData): string {
  const lines = [
    `# ${node.problem}`,
    '# Generated by anamorphic — implementation in progress',
    '',
  ];
  if (node.schema?.summary) lines.push(`# ${node.schema.summary}`, '');
  if (node.schema?.functions?.length) {
    lines.push('# Functions:');
    for (const fn of node.schema.functions) lines.push(`#   ${fn.signature}`);
    lines.push('');
  }
  return lines.join('\n');
}
