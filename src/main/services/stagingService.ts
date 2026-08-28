import fs from 'node:fs';
import path from 'node:path';
import { injectable } from 'tsyringe';
import { LogEntry } from '../../shared/types';
import {
  getStagedDir,
  getStagedDiffDir,
  getStagingBaseDir,
  safeRemoveDirectorySync,
  sanitizeBranchName,
} from '../config';

@injectable()
export class StagingService {
  /**
   * Prepares an isolated staging workspace for code review execution.
   * Copies files excluding `.git/` and `CLAUDE.md`, and writes `context.json`.
   */
  public prepareStagingWorkspace(
    workspaceDir: string,
    gitUrl: string,
    branch: string,
    commitSha: string,
    onLog?: (entry: LogEntry) => void
  ): { stagedDir: string; contextJsonPath: string } {
    const log = (message: string) => {
      if (onLog) {
        onLog({
          timestamp: new Date().toISOString(),
          source: 'staging',
          message,
        });
      }
    };

    const stagedDir = getStagedDir(gitUrl, branch);
    log(`[STAGING] Preparing staging directory at: ${stagedDir}`);

    if (fs.existsSync(stagedDir)) {
      log(`[STAGING] Cleaning pre-existing staging directory...`);
      safeRemoveDirectorySync(stagedDir);
    }

    fs.mkdirSync(stagedDir, { recursive: true });

    log(`[STAGING] Copying workspace files (excluding .git/ and CLAUDE.md)...`);
    const stagingBaseName = path.basename(getStagingBaseDir());
    this.copyDirectoryExcluding(workspaceDir, stagedDir, [
      '.git',
      'CLAUDE.md',
      'staging',
      'staged',
      '.agentic-code-review',
      stagingBaseName,
    ]);

    // Create reports directory if it doesn't exist yet
    const reportsDir = path.join(stagedDir, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Generate context.json
    const contextJsonPath = path.join(stagedDir, 'context.json');
    const contextData = {
      repoUrl: gitUrl,
      branch: branch,
      commitSha: commitSha,
      stagedAt: new Date().toISOString(),
    };

    log(`[STAGING] Writing context metadata to context.json...`);
    fs.writeFileSync(contextJsonPath, JSON.stringify(contextData, null, 2), 'utf-8');

    log(`[STAGING] Workspace staging completed successfully.`);
    return { stagedDir, contextJsonPath };
  }

  /**
   * Prepares an isolated parent staging workspace for Flow 2 diff review execution.
   * Copies `base/`, `compare/`, `diff.patch`, excluding `.git/` and `CLAUDE.md`, and writes `context.json`.
   */
  public prepareDiffStagingWorkspace(
    workspaceDir: string,
    gitUrl: string,
    baseBranch: string,
    compareBranch: string,
    changeSpec: string,
    baseCommitSha: string,
    compareCommitSha: string,
    onLog?: (entry: LogEntry) => void
  ): { stagedDir: string; contextJsonPath: string } {
    const log = (message: string) => {
      if (onLog) {
        onLog({
          timestamp: new Date().toISOString(),
          source: 'staging',
          message,
        });
      }
    };

    const stagedDir = getStagedDiffDir(gitUrl, baseBranch, compareBranch);
    log(`[STAGING] Preparing diff staging directory at: ${stagedDir}`);

    if (fs.existsSync(stagedDir)) {
      log(`[STAGING] Cleaning pre-existing diff staging directory...`);
      safeRemoveDirectorySync(stagedDir);
    }

    fs.mkdirSync(stagedDir, { recursive: true });

    log(`[STAGING] Copying base and compare subtrees (excluding .git/ and CLAUDE.md)...`);
    const exclusions = [
      '.git',
      'CLAUDE.md',
      'staging',
      'staged',
      '.agentic-code-review',
      path.basename(getStagingBaseDir()),
    ];

    const baseSrc = path.join(workspaceDir, 'base');
    const compareSrc = path.join(workspaceDir, 'compare');
    const diffPatchSrc = path.join(workspaceDir, 'diff.patch');

    const baseDest = path.join(stagedDir, 'base');
    const compareDest = path.join(stagedDir, 'compare');
    const diffPatchDest = path.join(stagedDir, 'diff.patch');

    fs.mkdirSync(baseDest, { recursive: true });
    fs.mkdirSync(compareDest, { recursive: true });

    this.copyDirectoryExcluding(baseSrc, baseDest, exclusions);
    this.copyDirectoryExcluding(compareSrc, compareDest, exclusions);

    if (fs.existsSync(diffPatchSrc)) {
      fs.copyFileSync(diffPatchSrc, diffPatchDest);
    }

    const reportsDir = path.join(stagedDir, 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const contextJsonPath = path.join(stagedDir, 'context.json');
    const contextData = {
      repoUrl: gitUrl,
      baseBranch,
      baseCommitSha,
      compareBranch,
      compareCommitSha,
      changeSpec,
      stagedAt: new Date().toISOString(),
    };

    log(`[STAGING] Writing diff context metadata to context.json...`);
    fs.writeFileSync(contextJsonPath, JSON.stringify(contextData, null, 2), 'utf-8');

    log(`[STAGING] Diff workspace staging completed successfully.`);
    return { stagedDir, contextJsonPath };
  }

  private copyDirectoryExcluding(src: string, dest: string, exclusions: string[]): void {
    if (!fs.existsSync(src)) return;

    const prevNoAsar = (process as unknown as { noAsar?: boolean }).noAsar;
    try {
      (process as unknown as { noAsar?: boolean }).noAsar = true;
      const entries = fs.readdirSync(src, { withFileTypes: true });

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        // Check exclusions (matches exact name e.g. .git or CLAUDE.md)
        if (exclusions.includes(entry.name)) {
          continue;
        }

        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          this.copyDirectoryExcluding(srcPath, destPath, exclusions);
        } else if (entry.isFile() || entry.isSymbolicLink()) {
          try {
            fs.copyFileSync(srcPath, destPath);
          } catch {
            // Fallback or ignore unreadable files
          }
        }
      }
    } finally {
      (process as unknown as { noAsar?: boolean }).noAsar = prevNoAsar;
    }
  }
}
