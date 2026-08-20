import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectable, inject } from 'tsyringe';
import { LogEntry } from '../../shared/types';
import { isError } from '../../shared/typeGuards';
import { getPromptFilePath } from '../config';
import { ReportService } from './reportService';

@injectable()
export class AgentInvoker {
  private static readonly PLATFORM_DEFAULT_SHELLS: Record<string, string> = {
    darwin: '/bin/zsh',
    linux: '/bin/bash',
  };

  private activeProcess: ChildProcess | null = null;
  private isAborted: boolean = false;

  constructor(@inject(ReportService) private reportService: ReportService = new ReportService()) {}

  /**
   * Spawns `run-agent` subprocess to run code review prompt on the staged directory.
   */
  public async runAgent(
    stagedDir: string,
    onLog?: (entry: LogEntry) => void,
    customPromptContent?: string
  ): Promise<{ success: boolean; aborted?: boolean; error?: string }> {
    const log = (message: string, source: LogEntry['source'] = 'agent') => {
      if (onLog) {
        onLog({
          timestamp: new Date().toISOString(),
          source,
          message,
        });
      }
    };

    this.isAborted = false;
    let promptContent = customPromptContent || '';

    if (!promptContent) {
      const promptPath = getPromptFilePath();
      log(`[AGENT] Locating code review prompt at: ${promptPath}`);
      if (!fs.existsSync(promptPath)) {
        const err = `Prompt file not found at ${promptPath}`;
        log(`[AGENT ERROR] ${err}`, 'stderr');
        return { success: false, error: err };
      }

      try {
        promptContent = fs.readFileSync(promptPath, 'utf-8');
      } catch (err: unknown) {
        const msg = `Failed to read prompt file: ${isError(err) ? err.message : String(err)}`;
        log(`[AGENT ERROR] ${msg}`, 'stderr');
        return { success: false, error: msg };
      }
    }

    let shell: string;
    try {
      shell = this.resolveLoginShell();
    } catch (err: unknown) {
      const msg = isError(err) ? err.message : String(err);
      log(`[AGENT ERROR] ${msg}`, 'stderr');
      return { success: false, error: msg };
    }

    log(`[AGENT] Shell environment check for 'run-agent' (shell: ${shell})...`);
    const runAgentCmd = `run-agent . -p ${this.escapeShellArg(promptContent)}`;

    log(`[AGENT] Spawning subprocess: run-agent . -p ... (working dir: ${stagedDir})`);

    const stdoutLines: string[] = [];

    return new Promise((resolve) => {
      // Interactive shell (-i) so the user's rc file is sourced; `run-agent` is
      // expected to be an alias, which only exists in interactive shell state.
      const child = spawn(shell, ['-i', '-c', runAgentCmd], {
        cwd: stagedDir,
        env: { ...process.env, FORCE_COLOR: '1' },
      });

      this.activeProcess = child;

      child.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            stdoutLines.push(line);
            log(line, 'agent');
          }
        }
      });

      child.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            // Check for missing alias/command notice
            if (line.includes('command not found') || line.includes('run-agent: not found')) {
              log(
                `[AGENT WARNING] 'run-agent' was not found by ${shell}. Define it as an alias in ${this.rcFileHint(shell)}, or set AGENT_SHELL to the shell whose startup file declares it.`,
                'stderr'
              );
            }
            log(line, 'stderr');
          }
        }
      });

      child.on('error', (err) => {
        this.activeProcess = null;
        log(`[AGENT ERROR] Subprocess execution error: ${err.message}`, 'stderr');
        resolve({ success: false, error: err.message });
      });

      child.on('close', (code, signal) => {
        this.activeProcess = null;
        if (this.isAborted || signal === 'SIGTERM' || signal === 'SIGINT') {
          log(`[AGENT] Execution aborted by user.`, 'agent');
          resolve({ success: false, aborted: true, error: 'Execution aborted by user' });
          return;
        }

        // Attempt stdout fallback report extraction if no files on disk
        this.reportService.extractReportFromStdout(stdoutLines, stagedDir, (msg) =>
          log(msg, 'agent')
        );

        if (code === 0) {
          log(`[AGENT] Execution completed successfully (exit code 0).`, 'agent');
          resolve({ success: true });
        } else {
          log(`[AGENT WARNING] Execution finished with exit code ${code}.`, 'stderr');
          resolve({ success: code === 0 || code === null });
        }
      });
    });
  }

  /**
   * Aborts active execution if running.
   */
  public abortExecution(): boolean {
    if (this.activeProcess) {
      this.isAborted = true;
      this.activeProcess.kill('SIGTERM');
      return true;
    }
    return false;
  }

  /**
   * Resolves the shell whose startup file declares the `run-agent` alias.
   *
   * `os.userInfo().shell` reads the passwd / directory-service record, so it is
   * correct even when the app is launched from Finder or a desktop launcher,
   * where the process environment carries no SHELL and only a minimal PATH.
   * `process.env.SHELL` and the platform default are fallbacks for hosts with no
   * passwd entry, such as some containers.
   */
  private resolveLoginShell(): string {
    const override = process.env.AGENT_SHELL;
    if (override) {
      return override;
    }

    if (process.platform === 'win32') {
      throw new Error(
        "Unsupported platform: 'run-agent' is resolved through a login shell alias, which has no Windows equivalent. Set AGENT_SHELL to a POSIX shell path to override."
      );
    }

    try {
      const { shell } = os.userInfo();
      if (shell) {
        return shell;
      }
    } catch {
      // No passwd entry for this uid; fall through to the environment.
    }

    return process.env.SHELL || AgentInvoker.PLATFORM_DEFAULT_SHELLS[process.platform] || '/bin/sh';
  }

  /**
   * Startup file the given shell sources for interactive sessions, used to make
   * the missing-alias warning actionable.
   */
  private rcFileHint(shell: string): string {
    const name = path.basename(shell);
    switch (name) {
      case 'zsh':
        return '~/.zshrc';
      case 'bash':
        return '~/.bashrc';
      case 'fish':
        return '~/.config/fish/config.fish';
      default:
        return `your ${name} startup file`;
    }
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
