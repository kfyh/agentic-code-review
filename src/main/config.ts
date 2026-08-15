import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';

export function getUserDataDir(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // Fallback if app is not ready or running outside Electron process
  }
  return path.join(os.homedir(), '.agentic-code-review');
}

export function getHistoryFilePath(): string {
  return path.join(getUserDataDir(), 'repo_history.json');
}

export function getBaseAppDir(): string {
  return path.join(os.homedir(), '.agentic-code-review');
}

export function getGitCacheDir(): string {
  return path.join(getBaseAppDir(), 'cache');
}

export function getWorkspacesDir(): string {
  return path.join(getBaseAppDir(), 'workspaces');
}

let customStagingDir: string | null = null;

export function setStagingDir(dir: string | null): void {
  customStagingDir = dir && dir.trim() ? path.resolve(dir.trim()) : null;
}

export function getStagingBaseDir(): string {
  if (customStagingDir) {
    return customStagingDir;
  }
  if (process.env.STAGING_DIR && process.env.STAGING_DIR.trim()) {
    return path.resolve(process.env.STAGING_DIR.trim());
  }
  if (process.env.CODE_REVIEW_STAGING_DIR && process.env.CODE_REVIEW_STAGING_DIR.trim()) {
    return path.resolve(process.env.CODE_REVIEW_STAGING_DIR.trim());
  }
  // Default to hidden .agentic-code-review/staged folder in home directory
  return path.join(getBaseAppDir(), 'staged');
}

export function getStagedDir(commitSha: string): string {
  return path.join(getStagingBaseDir(), commitSha);
}

export function getPromptFilePath(): string {
  // Primary path in workspace root
  return path.join(process.cwd(), 'code-review-prompt.md');
}
