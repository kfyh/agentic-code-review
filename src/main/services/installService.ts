import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { LogEntry } from '../../shared/types';

const execAsync = util.promisify(exec);

export class InstallService {
  /**
   * Executes host-side `npm install` in the checked-out workspace directory
   * prior to staging copy to ensure node_modules are available for AST tools.
   */
  public async installDependencies(
    workspaceDir: string,
    onLog?: (entry: LogEntry) => void
  ): Promise<{ success: boolean; installed: boolean; error?: string }> {
    const log = (message: string, source: LogEntry['source'] = 'install') => {
      if (onLog) {
        onLog({
          timestamp: new Date().toISOString(),
          source,
          message,
        });
      }
    };

    const packageJsonPath = path.join(workspaceDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      log(`[INSTALL] No package.json found in ${workspaceDir}. Skipping npm install.`, 'install');
      return { success: true, installed: false };
    }

    const hasLockFile = fs.existsSync(path.join(workspaceDir, 'package-lock.json'));
    const command = hasLockFile
      ? 'npm ci --no-audit --no-fund'
      : 'npm install --no-audit --no-fund';

    log(
      `[INSTALL] Executing host dependency installation: ${command} in ${workspaceDir}...`,
      'install'
    );

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceDir,
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      if (stdout && stdout.trim()) {
        stdout.split('\n').forEach((line) => {
          if (line.trim()) log(line, 'install');
        });
      }

      if (stderr && stderr.trim()) {
        stderr.split('\n').forEach((line) => {
          if (line.trim()) log(line, 'stderr');
        });
      }

      log(`[INSTALL] Host dependency installation completed successfully.`, 'install');
      return { success: true, installed: true };
    } catch (err: unknown) {
      const errorObj = err as { stderr?: string; message?: string };
      const errMsg = errorObj?.stderr || errorObj?.message || String(err);
      log(`[INSTALL WARNING] npm install failed or completed with warnings: ${errMsg}`, 'stderr');
      log(
        `[INSTALL NOTICE] Proceeding with staging so static analysis can analyze available source files.`,
        'install'
      );
      return { success: false, installed: false, error: errMsg };
    }
  }
}

export const installService = new InstallService();
