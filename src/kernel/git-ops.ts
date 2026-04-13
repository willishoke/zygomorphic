/**
 * git-ops.ts — Maps categorical operations to git operations.
 *
 * Tensor decomposition → parallel git branches (enforces causal isolation).
 * Composition (sequential work) → merge into parent branch.
 * Factoring history = git log of .zygomorphic/plan/ files.
 *
 * Design principle: tensor branches share no mutable state. A merge
 * conflict between tensor branches is a type error surfaced late.
 * The git integration is an enforcement layer, not a coordination layer.
 */

import { execSync, type ExecSyncOptions } from 'child_process';

// --- Types ---

export interface BranchInfo {
  name: string;
  morphismId: string;
  parentBranch: string;
  created: boolean;
}

export interface FactoringLogEntry {
  commit: string;
  date: string;
  message: string;
  files: string[];
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
}

// --- Helpers ---

function git(args: string, cwd: string): string {
  const opts: ExecSyncOptions = { cwd, stdio: ['ignore', 'pipe', 'ignore'] };
  return execSync(`git ${args}`, opts).toString().trim();
}

function gitLines(args: string, cwd: string): string[] {
  const out = git(args, cwd);
  return out ? out.split('\n').filter(l => l.length > 0) : [];
}

// --- Branch operations ---

/**
 * Branch naming convention for morphism work.
 * Tensor branches get a prefix indicating parallel work.
 */
export function branchName(morphismId: string, parentBranch: string): string {
  return `zyg/${parentBranch}/${morphismId}`;
}

/**
 * Create a branch for a morphism, forked from the parent.
 * This is the git-level enforcement of tensor isolation:
 * parallel morphisms get independent branches.
 */
export function createBranch(
  cwd: string,
  morphismId: string,
  parentBranch: string,
): BranchInfo {
  const name = branchName(morphismId, parentBranch);

  // Check if branch already exists
  try {
    git(`rev-parse --verify ${name}`, cwd);
    return { name, morphismId, parentBranch, created: false };
  } catch {
    // Branch doesn't exist, create it
  }

  git(`branch ${name} ${parentBranch}`, cwd);
  return { name, morphismId, parentBranch, created: true };
}

/**
 * Create parallel branches for tensor decomposition.
 * Returns branches for both the left and right morphisms.
 * Causal independence enforced: both fork from the same parent commit.
 */
export function tensorBranches(
  cwd: string,
  leftId: string,
  rightId: string,
  parentBranch: string,
): { left: BranchInfo; right: BranchInfo } {
  return {
    left: createBranch(cwd, leftId, parentBranch),
    right: createBranch(cwd, rightId, parentBranch),
  };
}

// --- Merge (composition) ---

/**
 * Merge a morphism branch back into its parent.
 * This is the git-level operation for sequential composition:
 * once a morphism completes, its output feeds into the next stage.
 *
 * Returns merge result. Conflicts indicate type errors surfaced late
 * (tensor branches that weren't truly independent).
 */
export function mergeBranch(
  cwd: string,
  sourceBranch: string,
  targetBranch: string,
): MergeResult {
  // Save current branch
  const current = git('rev-parse --abbrev-ref HEAD', cwd);

  try {
    git(`checkout ${targetBranch}`, cwd);
    git(`merge --no-ff ${sourceBranch} -m "Merge ${sourceBranch} into ${targetBranch}"`, cwd);
    return { success: true };
  } catch {
    // Check for merge conflicts
    const status = gitLines('diff --name-only --diff-filter=U', cwd);
    if (status.length > 0) {
      // Abort the failed merge
      try { git('merge --abort', cwd); } catch { /* already clean */ }
      return { success: false, conflicts: status };
    }
    return { success: false, conflicts: ['Unknown merge error'] };
  } finally {
    // Return to original branch
    try { git(`checkout ${current}`, cwd); } catch { /* best effort */ }
  }
}

// --- Factoring history ---

/**
 * Get the factoring history from git log of plan files.
 * Each commit to .zygomorphic/plan/ represents a factoring operation.
 */
export function factoringHistory(
  cwd: string,
  planDir: string = '.zygomorphic/plan',
  limit: number = 50,
): FactoringLogEntry[] {
  try {
    const logs = gitLines(
      `log --follow --pretty=format:"%H|%aI|%s" -n ${limit} -- "${planDir}"`,
      cwd,
    );
    return logs.map(line => {
      const [commit, date, ...msgParts] = line.split('|');
      const message = msgParts.join('|');

      // Get files changed in this commit
      let files: string[] = [];
      try {
        files = gitLines(`diff-tree --no-commit-id --name-only -r ${commit} -- "${planDir}"`, cwd);
      } catch { /* no files */ }

      return { commit, date, message, files };
    });
  } catch {
    return [];
  }
}

/**
 * Get the factoring history for a specific morphism.
 */
export function morphismHistory(
  cwd: string,
  morphismId: string,
  planDir: string = '.zygomorphic/plan',
): FactoringLogEntry[] {
  const filePath = `${planDir}/${morphismId}.md`;
  try {
    const logs = gitLines(
      `log --follow --pretty=format:"%H|%aI|%s" -- "${filePath}"`,
      cwd,
    );
    return logs.map(line => {
      const [commit, date, ...msgParts] = line.split('|');
      return { commit, date, message: msgParts.join('|'), files: [filePath] };
    });
  } catch {
    return [];
  }
}

// --- Validation hooks ---

/**
 * Check if there are uncommitted changes in the plan directory.
 * Useful for detecting unsaved factoring operations.
 */
export function hasPlanChanges(
  cwd: string,
  planDir: string = '.zygomorphic/plan',
): boolean {
  try {
    const status = gitLines(`status --porcelain -- "${planDir}"`, cwd);
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * List branches matching the zyg/ prefix (active morphism branches).
 */
export function activeBranches(cwd: string): string[] {
  try {
    return gitLines('branch --list "zyg/*"', cwd)
      .map(b => b.replace(/^\*?\s+/, ''));
  } catch {
    return [];
  }
}
