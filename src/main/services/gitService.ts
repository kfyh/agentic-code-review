import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { LogEntry } from '../../shared/types';
import { getGitCacheDir, getWorkspacesDir } from '../config';

const execAsync = promisify(exec);

export class GitService {
  /**
   * Auto-detects the remote default branch using `git ls-remote --symref <gitUrl> HEAD`.
   */
  public async detectRemoteDefaultBranch(
    gitUrl: string
  ): Promise<{ branch: string; isFallback: boolean; error?: string }> {
    if (!gitUrl || !gitUrl.trim()) {
      return { branch: 'main', isFallback: true, error: 'Empty Git URL provided' };
    }

    const cleanUrl = gitUrl.trim();

    try {
      // 10 second timeout for remote lookup
      const { stdout } = await execAsync(
        `git ls-remote --symref ${this.escapeShellArg(cleanUrl)} HEAD`,
        {
          timeout: 10000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }
      );

      // Parse ref: refs/heads/<branch>
      const match = stdout.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
      if (match && match[1]) {
        return { branch: match[1], isFallback: false };
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string; stderr?: string };
      console.warn(`Default branch query failed for ${cleanUrl}:`, errorObj?.message || err);
      return {
        branch: 'main',
        isFallback: true,
        error: errorObj?.stderr || errorObj?.message || 'Failed to detect remote default branch',
      };
    }

    return { branch: 'main', isFallback: true };
  }

  /**
   * Clones/fetches the repo, checks out the specified branch, resolves full SHA, and prepares workspace.
   */
  public async prepareGitWorkspace(
    gitUrl: string,
    branch: string,
    onLog?: (entry: LogEntry) => void
  ): Promise<{ commitSha: string; workspaceDir: string }> {
    const log = (message: string, source: LogEntry['source'] = 'git') => {
      if (onLog) {
        onLog({
          timestamp: new Date().toISOString(),
          source,
          message,
        });
      }
    };

    const cleanUrl = gitUrl.trim();
    const cleanBranch = branch.trim();

    // Create unique cache directory based on repo URL hash
    const repoHash = crypto.createHash('md5').update(cleanUrl).digest('hex');
    const cacheDir = path.join(getGitCacheDir(), repoHash);

    if (!fs.existsSync(getGitCacheDir())) {
      fs.mkdirSync(getGitCacheDir(), { recursive: true });
    }

    log(`[GIT] Target Repository: ${cleanUrl}`);
    log(`[GIT] Target Branch: ${cleanBranch}`);

    if (!fs.existsSync(cacheDir)) {
      log(`[GIT] Cloning repository into cache (${cacheDir})...`);
      await this.runGitCommand(
        `clone ${this.escapeShellArg(cleanUrl)} ${this.escapeShellArg(cacheDir)}`,
        undefined,
        log
      );
    } else {
      log(`[GIT] Repository cache exists. Fetching updates from origin...`);
      await this.runGitCommand(`fetch origin`, cacheDir, log);
    }

    log(`[GIT] Checking out branch ${cleanBranch}...`);
    try {
      await this.runGitCommand(`checkout ${this.escapeShellArg(cleanBranch)}`, cacheDir, log);
    } catch {
      log(`[GIT] Fetching and checking out origin/${cleanBranch}...`);
      await this.runGitCommand(`fetch origin ${this.escapeShellArg(cleanBranch)}`, cacheDir, log);
      await this.runGitCommand(
        `checkout -B ${this.escapeShellArg(cleanBranch)} origin/${this.escapeShellArg(cleanBranch)}`,
        cacheDir,
        log
      );
    }

    log(`[GIT] Syncing with origin/${cleanBranch}...`);
    try {
      await this.runGitCommand(`pull origin ${this.escapeShellArg(cleanBranch)}`, cacheDir, log);
    } catch (err: unknown) {
      log(
        `[GIT] Pull notice (using current head state): ${(err as Error)?.message || String(err)}`
      );
    }

    log(`[GIT] Resolving commit SHA...`);
    const shaResult = await this.runGitCommand(`rev-parse HEAD`, cacheDir, log);
    const commitSha = shaResult.trim();

    if (!commitSha || commitSha.length < 40) {
      throw new Error(`Failed to resolve valid full commit SHA. Received: '${commitSha}'`);
    }

    log(`[GIT] Resolved Commit SHA: ${commitSha}`);

    // Create workspace directory identified by commit SHA
    const workspaceDir = path.join(getWorkspacesDir(), commitSha);
    if (!fs.existsSync(workspaceDir)) {
      fs.mkdirSync(workspaceDir, { recursive: true });
    }

    log(`[GIT] Syncing repo code to workspace directory: ${workspaceDir}`);
    // Sync contents to workspace
    await this.runGitCommand(
      `archive ${commitSha} | (cd ${this.escapeShellArg(workspaceDir)} && tar -x)`,
      cacheDir,
      log
    );

    return { commitSha, workspaceDir };
  }

  private async runGitCommand(
    args: string,
    cwd?: string,
    log?: (msg: string, source: LogEntry['source']) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = `git ${args}`;
      exec(
        command,
        {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (stderr && stderr.trim()) {
            if (
              stderr.toLowerCase().includes('permission denied') ||
              stderr.toLowerCase().includes('publickey')
            ) {
              log?.(
                `[GIT SSH AUTH ERROR] SSH Authentication failed. Ensure your host SSH key is configured. Stderr: ${stderr.trim()}`,
                'stderr'
              );
            } else {
              log?.(`[GIT STDERR] ${stderr.trim()}`, 'stderr');
            }
          }
          if (error) {
            reject(new Error(`Git command failed (${command}): ${error.message}\n${stderr}`));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}

export const gitService = new GitService();
