import { execSync } from 'child_process';

export function getHeadCommit(cwd: string): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
