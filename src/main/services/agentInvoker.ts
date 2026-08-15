import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LogEntry } from '../../shared/types';
import { getPromptFilePath } from '../config';

export class AgentInvoker {
  private activeProcess: ChildProcess | null = null;
  private isAborted: boolean = false;

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
    } catch (err: any) {
      const msg = `Failed to read prompt file: ${err?.message || err}`;
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
              log(`[AGENT WARNING] 'run-agent' command or shell alias was not found in environment PATH. Ensure agentflow or run-agent is installed and aliased.`, 'stderr');
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
        this.extractReportFromStdout(stdoutLines, stagedDir, log);

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
   * Fallback extraction: Parses streamed stdout lines to recover markdown review report
   * if the container agent wrote to an unmounted path or failed to save to disk.
   */
  private extractReportFromStdout(
    stdoutLines: string[],
    stagedDir: string,
    log: (msg: string, source?: LogEntry['source']) => void
  ): boolean {
    const reportsDir = path.join(stagedDir, 'reports');
    if (fs.existsSync(reportsDir)) {
      const existing = fs.readdirSync(reportsDir).filter((f) => {
        if (!f.endsWith('.md')) return false;
        try {
          const stat = fs.statSync(path.join(reportsDir, f));
          return stat.size > 10;
        } catch {
          return false;
        }
      });
      if (existing.length > 0) {
        return true;
      }
    }

    let startIndex = -1;
    for (let i = 0; i < stdoutLines.length; i++) {
      const line = stdoutLines[i].trim();
      if (
        line.startsWith('# Code Smell') ||
        line.startsWith('# Code Review') ||
        line.startsWith('# Deliverables') ||
        line.startsWith('# Executive Summary') ||
        line.startsWith('# 1. Executive Summary') ||
        line.startsWith('# ')
      ) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) {
      return false;
    }

    const reportLines: string[] = [];
    for (let i = startIndex; i < stdoutLines.length; i++) {
      const line = stdoutLines[i];
      if (
        line.includes('🏁 Session Finished') ||
        line.includes('📊 Usage:') ||
        line.includes('❌ Session failed')
      ) {
        break;
      }
      if (!line.includes('🛠️ [Tool Use:')) {
        reportLines.push(line);
      }
    }

    if (reportLines.length === 0) {
      return false;
    }

    const reportText = reportLines.join('\n').trim();
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const targetPath = path.join(reportsDir, 'code_smells.md');
    fs.writeFileSync(targetPath, reportText, 'utf-8');
    log(`[AGENT STDOUT FALLBACK] Extracted report from stdout stream and saved to ${targetPath}`, 'agent');
    return true;
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

export const agentInvoker = new AgentInvoker();
