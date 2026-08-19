import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
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
  if (process.env.STAGING_DIR?.trim()) {
    return path.resolve(process.env.STAGING_DIR.trim());
  }
  if (process.env.CODE_REVIEW_STAGING_DIR?.trim()) {
    return path.resolve(process.env.CODE_REVIEW_STAGING_DIR.trim());
  }
  // Default to hidden .agentic-code-review/staged folder in home directory
  return path.join(getBaseAppDir(), 'staged');
}

export function getStagedDir(commitSha: string): string {
  return path.join(getStagingBaseDir(), commitSha);
}

/**
 * Safely removes a directory recursively, bypassing Electron's virtual asar interception.
 * Prevents ENOTDIR errors when encountering default_app.asar or packages with embedded asar archives.
 */
export function safeRemoveDirectorySync(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  const prevNoAsar = (process as unknown as { noAsar?: boolean }).noAsar;
  try {
    (process as unknown as { noAsar?: boolean }).noAsar = true;
    fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    try {
      (process as unknown as { noAsar?: boolean }).noAsar = true;
      manualRemoveRecursive(dirPath);
    } catch {
      // Ignore fallback deletion error
    }
  } finally {
    (process as unknown as { noAsar?: boolean }).noAsar = prevNoAsar;
  }
}

function manualRemoveRecursive(targetPath: string): void {
  if (!fs.existsSync(targetPath)) return;
  const prevNoAsar = (process as unknown as { noAsar?: boolean }).noAsar;
  try {
    (process as unknown as { noAsar?: boolean }).noAsar = true;
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(targetPath);
      for (const file of files) {
        manualRemoveRecursive(path.join(targetPath, file));
      }
      try {
        fs.rmdirSync(targetPath);
      } catch {
        // Ignore
      }
    } else {
      try {
        fs.unlinkSync(targetPath);
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore
  } finally {
    (process as unknown as { noAsar?: boolean }).noAsar = prevNoAsar;
  }
}

export function getPromptFilePath(): string {
  const candidatePaths: string[] = [];

  // 1. Electron process.resourcesPath (extraResources when packaged)
  if (process.resourcesPath) {
    candidatePaths.push(path.join(process.resourcesPath, 'src', 'prompts', 'code-review-prompt.md'));
    candidatePaths.push(path.join(process.resourcesPath, 'code-review-prompt.md'));
  }

  // 2. Electron app.getAppPath() (bundled inside app.asar / app directory)
  try {
    if (app && typeof app.getAppPath === 'function') {
      candidatePaths.push(path.join(app.getAppPath(), 'src', 'prompts', 'code-review-prompt.md'));
      candidatePaths.push(path.join(app.getAppPath(), 'code-review-prompt.md'));
    }
  } catch {
    // app not initialized
  }

  // 3. Current working directory (for CLI execution or dev mode)
  candidatePaths.push(path.join(process.cwd(), 'src', 'prompts', 'code-review-prompt.md'));
  candidatePaths.push(path.join(process.cwd(), 'code-review-prompt.md'));

  // 4. User Data Directory (~/.agentic-code-review/code-review-prompt.md)
  candidatePaths.push(path.join(getUserDataDir(), 'src', 'prompts', 'code-review-prompt.md'));
  candidatePaths.push(path.join(getUserDataDir(), 'code-review-prompt.md'));

  // Return the first candidate path that exists on disk
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Default fallback if file is not found anywhere
  if (process.resourcesPath && app?.isPackaged) {
    return path.join(process.resourcesPath, 'src', 'prompts', 'code-review-prompt.md');
  }
  return path.join(process.cwd(), 'src', 'prompts', 'code-review-prompt.md');
}

export function getDiffPromptFilePath(): string {
  const candidatePaths: string[] = [];

  if (process.resourcesPath) {
    candidatePaths.push(path.join(process.resourcesPath, 'src', 'prompts', 'code-review-diff-prompt.md'));
    candidatePaths.push(path.join(process.resourcesPath, 'code-review-diff-prompt.md'));
  }

  try {
    if (app && typeof app.getAppPath === 'function') {
      candidatePaths.push(path.join(app.getAppPath(), 'src', 'prompts', 'code-review-diff-prompt.md'));
      candidatePaths.push(path.join(app.getAppPath(), 'code-review-diff-prompt.md'));
    }
  } catch {
    // app not initialized
  }

  candidatePaths.push(path.join(process.cwd(), 'src', 'prompts', 'code-review-diff-prompt.md'));
  candidatePaths.push(path.join(process.cwd(), 'code-review-diff-prompt.md'));
  candidatePaths.push(path.join(getUserDataDir(), 'src', 'prompts', 'code-review-diff-prompt.md'));
  candidatePaths.push(path.join(getUserDataDir(), 'code-review-diff-prompt.md'));

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.resourcesPath && app?.isPackaged) {
    return path.join(process.resourcesPath, 'src', 'prompts', 'code-review-diff-prompt.md');
  }
  return path.join(process.cwd(), 'src', 'prompts', 'code-review-diff-prompt.md');
}
