import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  branchName, createBranch, tensorBranches,
  mergeBranch, factoringHistory, hasPlanChanges, activeBranches,
} from '../git-ops.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: tmpDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zyg-git-test-'));
  git('init');
  git('config user.email "test@zyg.test"');
  git('config user.name "Zyg Test"');
  git('checkout -b main');
  // Need at least one commit to branch from
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test');
  git('add README.md');
  git('commit -m "initial"');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('branchName', () => {
  it('produces zyg-prefixed branch names', () => {
    expect(branchName('implement_auth', 'main')).toBe('zyg/main/implement_auth');
  });
});

describe('createBranch', () => {
  it('creates a new branch', () => {
    const info = createBranch(tmpDir, 'write_code', 'main');
    expect(info.name).toBe('zyg/main/write_code');
    expect(info.created).toBe(true);
    expect(info.morphismId).toBe('write_code');

    // Branch should exist
    const branches = git('branch --list "zyg/*"');
    expect(branches).toContain('zyg/main/write_code');
  });

  it('returns created=false for existing branch', () => {
    createBranch(tmpDir, 'write_code', 'main');
    const info = createBranch(tmpDir, 'write_code', 'main');
    expect(info.created).toBe(false);
  });
});

describe('tensorBranches', () => {
  it('creates two parallel branches from same parent', () => {
    const { left, right } = tensorBranches(tmpDir, 'frontend', 'backend', 'main');
    expect(left.name).toBe('zyg/main/frontend');
    expect(right.name).toBe('zyg/main/backend');
    expect(left.created).toBe(true);
    expect(right.created).toBe(true);

    // Both should point to the same commit (forked from main)
    const leftCommit = git(`rev-parse ${left.name}`);
    const rightCommit = git(`rev-parse ${right.name}`);
    const mainCommit = git('rev-parse main');
    expect(leftCommit).toBe(mainCommit);
    expect(rightCommit).toBe(mainCommit);
  });
});

describe('mergeBranch', () => {
  it('merges a branch back into parent', () => {
    // Create branch, make a commit on it
    createBranch(tmpDir, 'feature', 'main');
    git('checkout zyg/main/feature');
    fs.writeFileSync(path.join(tmpDir, 'feature.ts'), 'export const x = 1;');
    git('add feature.ts');
    git('commit -m "add feature"');
    git('checkout main');

    const result = mergeBranch(tmpDir, 'zyg/main/feature', 'main');
    expect(result.success).toBe(true);

    // Feature file should be on main now
    expect(fs.existsSync(path.join(tmpDir, 'feature.ts'))).toBe(true);
  });

  it('detects merge conflicts', () => {
    // Create two branches that modify the same file
    createBranch(tmpDir, 'left', 'main');
    createBranch(tmpDir, 'right', 'main');

    // Left modifies README
    git('checkout zyg/main/left');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# left version');
    git('add README.md');
    git('commit -m "left change"');

    // Merge left into main
    git('checkout main');
    git('merge zyg/main/left');

    // Right also modifies README (conflict)
    git('checkout zyg/main/right');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# right version');
    git('add README.md');
    git('commit -m "right change"');
    git('checkout main');

    const result = mergeBranch(tmpDir, 'zyg/main/right', 'main');
    expect(result.success).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
  });
});

describe('factoringHistory', () => {
  it('returns empty for no plan files', () => {
    const history = factoringHistory(tmpDir);
    expect(history).toHaveLength(0);
  });

  it('returns commits touching plan directory', () => {
    const planDir = path.join(tmpDir, '.zygomorphic', 'plan');
    fs.mkdirSync(planDir, { recursive: true });

    fs.writeFileSync(path.join(planDir, 'morph1.md'), '---\nid: morph1\n---\n');
    git('add .zygomorphic/plan/morph1.md');
    git('commit -m "factor: add morph1"');

    fs.writeFileSync(path.join(planDir, 'morph2.md'), '---\nid: morph2\n---\n');
    git('add .zygomorphic/plan/morph2.md');
    git('commit -m "factor: add morph2"');

    const history = factoringHistory(tmpDir);
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].message).toContain('morph2'); // most recent first
  });
});

describe('hasPlanChanges', () => {
  it('detects uncommitted plan changes', () => {
    expect(hasPlanChanges(tmpDir)).toBe(false);

    const planDir = path.join(tmpDir, '.zygomorphic', 'plan');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, 'new.md'), 'test');

    expect(hasPlanChanges(tmpDir)).toBe(true);
  });
});

describe('activeBranches', () => {
  it('lists zyg/ branches', () => {
    expect(activeBranches(tmpDir)).toHaveLength(0);

    createBranch(tmpDir, 'a', 'main');
    createBranch(tmpDir, 'b', 'main');

    const branches = activeBranches(tmpDir);
    expect(branches).toHaveLength(2);
    expect(branches.sort()).toEqual(['zyg/main/a', 'zyg/main/b']);
  });
});
