import fs from 'node:fs';
import path from 'node:path';
import { injectable } from 'tsyringe';
import { LogEntry } from '../../shared/types';
import { getStagedDir, getStagingBaseDir } from '../config';

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

    const stagedDir = getStagedDir(commitSha);
    log(`[STAGING] Preparing staging directory at: ${stagedDir}`);

    if (fs.existsSync(stagedDir)) {
      log(`[STAGING] Cleaning pre-existing staging directory...`);
      fs.rmSync(stagedDir, { recursive: true, force: true });
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

  private copyDirectoryExcluding(src: string, dest: string, exclusions: string[]): void {
    if (!fs.existsSync(src)) return;

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
  }
}
