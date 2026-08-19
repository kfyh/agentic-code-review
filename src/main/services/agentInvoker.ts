import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { injectable, inject } from 'tsyringe';
import { LogEntry } from '../../shared/types';
import { isError } from '../../shared/typeGuards';
import { getPromptFilePath } from '../config';
import { ReportService } from './reportService';

@injectable()
export class AgentInvoker {
  private activeProcess: ChildProcess | null = null;
  private isAborted: boolean = false;

  constructor(@inject(ReportService) private reportService: ReportService = new ReportService()) {}

  /**
   * Spawns `run-agent` subprocess to run code review prompt on the staged directory.
   */
  public async runAgent(
    stagedDir: string,
    onLog?: (entry: LogEntry) => void
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
    const promptPath = getPromptFilePath();

    log(`[AGENT] Locating code review prompt at: ${promptPath}`);
    if (!fs.existsSync(promptPath)) {
      const err = `Prompt file not found at ${promptPath}`;
      log(`[AGENT ERROR] ${err}`, 'stderr');
      return { success: false, error: err };
    }

    let promptContent = '';
    try {
      promptContent = fs.readFileSync(promptPath, 'utf-8');
    } catch (err: unknown) {
      const msg = `Failed to read prompt file: ${isError(err) ? err.message : String(err)}`;
      log(`[AGENT ERROR] ${msg}`, 'stderr');
      return { success: false, error: msg };
    }

    log(`[AGENT] Shell environment check for 'run-agent'...`);
    const runAgentCmd = `run-agent . -p ${this.escapeShellArg(promptContent)}`;

    log(`[AGENT] Spawning subprocess: run-agent . -p ... (working dir: ${stagedDir})`);

    const stdoutLines: string[] = [];

    return new Promise((resolve) => {
      // Execute through login/interactive shell inside stagedDir
      const child = spawn('/bin/bash', ['-i', '-c', runAgentCmd], {
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
                `[AGENT WARNING] 'run-agent' command or shell alias was not found in environment PATH. Ensure agentflow or run-agent is installed and aliased.`,
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

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
}
