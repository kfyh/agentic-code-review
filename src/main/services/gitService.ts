import { exec } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { injectable } from 'tsyringe';
import { LogEntry } from '../../shared/types';
import { isError, isErrorWithMessage } from '../../shared/typeGuards';
import {
  getGitCacheDir,
  getWorkspacesDir,
  safeRemoveDirectorySync,
  sanitizeBranchName,
} from '../config';

const execAsync = promisify(exec);

@injectable()
export class GitService {
  /**
   * Fetches all remote branches using `git ls-remote --heads <gitUrl>`.
   */
  public async getRemoteBranches(
    gitUrl: string
  ): Promise<{ success: boolean; branches: string[]; error?: string }> {
    if (!gitUrl || !gitUrl.trim()) {
      return { success: false, branches: [], error: 'Empty Git URL provided' };
    }

    const cleanUrl = gitUrl.trim();

    try {
      const { stdout } = await execAsync(`git ls-remote --heads ${this.escapeShellArg(cleanUrl)}`, {
        timeout: 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });

      const branches: string[] = [];
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/[0-9a-f]+\s+refs\/heads\/(.+)$/i);
        if (match && match[1]) {
          const branchName = match[1].trim();
          if (branchName && !branches.includes(branchName)) {
            branches.push(branchName);
          }
        }
      }

      // Sort: main/master first, then alphabetical
      branches.sort((a, b) => {
        if (a === 'main' || a === 'master') return -1;
        if (b === 'main' || b === 'master') return 1;
        return a.localeCompare(b);
      });

      return { success: true, branches };
    } catch (err: unknown) {
      const message = isErrorWithMessage(err) ? err.message : String(err);
      console.warn(`Remote branch list query failed for ${cleanUrl}:`, message);

      // Check if local cache dir exists and try local git branch -r
      const repoHash = crypto.createHash('md5').update(cleanUrl).digest('hex');
      const cacheDir = path.join(getGitCacheDir(), repoHash);

      if (fs.existsSync(cacheDir)) {
        try {
          const { stdout: cachedStdout } = await execAsync(`git branch -r`, { cwd: cacheDir });
          const cachedBranches: string[] = [];
          const lines = cachedStdout.split('\n');
          for (const line of lines) {
            const clean = line.trim().replace(/^origin\//, '');
            if (clean && !clean.includes('->') && !cachedBranches.includes(clean)) {
              cachedBranches.push(clean);
            }
          }
          if (cachedBranches.length > 0) {
            return { success: true, branches: cachedBranches };
          }
        } catch {
          // ignore cache fallback error
        }
      }

      return { success: false, branches: [], error: message };
    }
  }

  /**
   * Auto-detects the remote default branch using `git ls-remote --symref <gitUrl> HEAD`
   * with fallback to querying remote heads.
   */
  public async detectRemoteDefaultBranch(
    gitUrl: string
  ): Promise<{ branch: string; isFallback: boolean; error?: string }> {
    if (!gitUrl || !gitUrl.trim()) {
      return { branch: 'main', isFallback: true, error: 'Empty Git URL provided' };
    }

    const cleanUrl = gitUrl.trim();

    try {
      // 1. Try --symref lookup
      const { stdout } = await execAsync(
        `git ls-remote --symref ${this.escapeShellArg(cleanUrl)} HEAD`,
        {
          timeout: 10000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        }
      );

      const match = stdout.match(/ref:\s+refs\/heads\/([^\s]+)\s+HEAD/);
      if (match && match[1]) {
        return { branch: match[1], isFallback: false };
      }
    } catch {
      // Ignore symref failure and proceed to heads fallback
    }

    // 2. Fallback to listing remote heads
    const headsResult = await this.getRemoteBranches(cleanUrl);
    if (headsResult.success && headsResult.branches.length > 0) {
      if (headsResult.branches.includes('main')) {
        return { branch: 'main', isFallback: false };
      }
      if (headsResult.branches.includes('master')) {
        return { branch: 'master', isFallback: false };
      }
      return { branch: headsResult.branches[0], isFallback: false };
    }

    return {
      branch: 'main',
      isFallback: true,
      error: headsResult.error || 'Failed to detect remote default branch',
    };
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
      const msg = isError(err) ? err.message : String(err);
      log(`[GIT] Pull notice (using current head state): ${msg}`);
    }

    log(`[GIT] Resolving commit SHA...`);
    const shaResult = await this.runGitCommand(`rev-parse HEAD`, cacheDir, log);
    const commitSha = shaResult.trim();

    if (!commitSha || commitSha.length < 40) {
      throw new Error(`Failed to resolve valid full commit SHA. Received: '${commitSha}'`);
    }

    log(`[GIT] Resolved Commit SHA: ${commitSha}`);

    // Create workspace directory identified by branch key
    const workspaceDir = path.join(getWorkspacesDir(), sanitizeBranchName(cleanBranch));
    if (fs.existsSync(workspaceDir)) {
      safeRemoveDirectorySync(workspaceDir);
    }
    fs.mkdirSync(workspaceDir, { recursive: true });

    log(`[GIT] Syncing repo code to workspace directory: ${workspaceDir}`);
    // Sync contents to workspace
    await this.runGitCommand(
      `archive ${commitSha} | (cd ${this.escapeShellArg(workspaceDir)} && tar -x)`,
      cacheDir,
      log
    );

    return { commitSha, workspaceDir };
  }

  /**
   * Fetches base and compare branches, exports both subtrees, and generates host unified git diff patch.
   */
  public async prepareDiffGitWorkspace(
    gitUrl: string,
    baseBranch: string,
    compareBranch: string,
    onLog?: (entry: LogEntry) => void
  ): Promise<{
    baseCommitSha: string;
    compareCommitSha: string;
    workspaceDir: string;
    diffPatchPath: string;
  }> {
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
    const cleanBase = baseBranch.trim();
    const cleanCompare = compareBranch.trim();

    const repoHash = crypto.createHash('md5').update(cleanUrl).digest('hex');
    const cacheDir = path.join(getGitCacheDir(), repoHash);

    if (!fs.existsSync(getGitCacheDir())) {
      fs.mkdirSync(getGitCacheDir(), { recursive: true });
    }

    log(`[GIT DIFF] Target Repository: ${cleanUrl}`);
    log(`[GIT DIFF] Base Branch: ${cleanBase} | Compare Branch: ${cleanCompare}`);

    if (!fs.existsSync(cacheDir)) {
      log(`[GIT DIFF] Cloning repository into cache (${cacheDir})...`);
      await this.runGitCommand(
        `clone ${this.escapeShellArg(cleanUrl)} ${this.escapeShellArg(cacheDir)}`,
        undefined,
        log
      );
    } else {
      log(`[GIT DIFF] Fetching updates from origin...`);
      await this.runGitCommand(`fetch origin`, cacheDir, log);
    }

    // Checkout and resolve base branch SHA
    log(`[GIT DIFF] Resolving base branch (${cleanBase})...`);
    try {
      await this.runGitCommand(`fetch origin ${this.escapeShellArg(cleanBase)}`, cacheDir, log);
    } catch (fetchErr) {
      log(
        `[GIT DIFF NOTICE] Fetching base branch ${cleanBase} notice: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
      );
    }

    try {
      await this.runGitCommand(`checkout ${this.escapeShellArg(cleanBase)}`, cacheDir, log);
    } catch {
      log(`[GIT DIFF] Local checkout failed, checking out origin/${cleanBase}...`);
      await this.runGitCommand(
        `checkout -B ${this.escapeShellArg(cleanBase)} origin/${this.escapeShellArg(cleanBase)}`,
        cacheDir,
        log
      );
    }
    const baseSha = (await this.runGitCommand(`rev-parse HEAD`, cacheDir, log)).trim();
    if (!/^[0-9a-fA-F]{40}$/.test(baseSha)) {
      throw new Error(
        `Failed to resolve valid full commit SHA for base branch "${cleanBase}": received "${baseSha}"`
      );
    }

    // Checkout and resolve compare branch SHA
    log(`[GIT DIFF] Resolving compare branch (${cleanCompare})...`);
    try {
      await this.runGitCommand(`fetch origin ${this.escapeShellArg(cleanCompare)}`, cacheDir, log);
    } catch (fetchErr) {
      log(
        `[GIT DIFF NOTICE] Fetching compare branch ${cleanCompare} notice: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`
      );
    }

    try {
      await this.runGitCommand(`checkout ${this.escapeShellArg(cleanCompare)}`, cacheDir, log);
    } catch {
      log(`[GIT DIFF] Local checkout failed, checking out origin/${cleanCompare}...`);
      await this.runGitCommand(
        `checkout -B ${this.escapeShellArg(cleanCompare)} origin/${this.escapeShellArg(cleanCompare)}`,
        cacheDir,
        log
      );
    }
    const compareSha = (await this.runGitCommand(`rev-parse HEAD`, cacheDir, log)).trim();
    if (!/^[0-9a-fA-F]{40}$/.test(compareSha)) {
      throw new Error(
        `Failed to resolve valid full commit SHA for compare branch "${cleanCompare}": received "${compareSha}"`
      );
    }

    log(`[GIT DIFF] Base SHA: ${baseSha} | Compare SHA: ${compareSha}`);

    const workspaceDir = path.join(getWorkspacesDir(), `diff-${sanitizeBranchName(cleanCompare)}`);
    const baseDir = path.join(workspaceDir, 'base');
    const compareDir = path.join(workspaceDir, 'compare');

    if (fs.existsSync(workspaceDir)) {
      safeRemoveDirectorySync(workspaceDir);
    }
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(compareDir, { recursive: true });

    log(`[GIT DIFF] Exporting base code (${baseSha}) to ${baseDir}...`);
    await this.runGitCommand(
      `archive ${baseSha} | (cd ${this.escapeShellArg(baseDir)} && tar -x)`,
      cacheDir,
      log
    );

    log(`[GIT DIFF] Exporting compare code (${compareSha}) to ${compareDir}...`);
    await this.runGitCommand(
      `archive ${compareSha} | (cd ${this.escapeShellArg(compareDir)} && tar -x)`,
      cacheDir,
      log
    );

    log(`[GIT DIFF] Generating git diff patch...`);
    const diffPatchPath = path.join(workspaceDir, 'diff.patch');
    const patchContent = await this.runGitCommand(`diff ${baseSha} ${compareSha}`, cacheDir, log);
    fs.writeFileSync(diffPatchPath, patchContent, 'utf-8');

    log(`[GIT DIFF] Diff patch saved to ${diffPatchPath} (${patchContent.length} bytes).`);

    return {
      baseCommitSha: baseSha,
      compareCommitSha: compareSha,
      workspaceDir,
      diffPatchPath,
    };
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
