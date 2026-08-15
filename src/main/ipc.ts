import { BrowserWindow, ipcMain } from 'electron';
import { LogEntry, ReviewRequest, ReviewStateUpdate } from '../shared/types';
import { agentInvoker } from './services/agentInvoker';
import { gitService } from './services/gitService';
import { historyService } from './services/historyService';
import { installService } from './services/installService';
import { reportService } from './services/reportService';
import { stagingService } from './services/stagingService';

import { getStagingBaseDir, setStagingDir } from './config';

export function setupIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  const sendStateUpdate = (update: ReviewStateUpdate) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('review-state-update', update);
    }
  };

  const sendLogEntry = (log: LogEntry) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('log-entry', log);
    }
  };

  // Staging directory configuration handlers
  ipcMain.handle('get-staging-dir', async () => {
    return getStagingBaseDir();
  });

  ipcMain.handle('set-staging-dir', async (_, dir: string) => {
    setStagingDir(dir);
    return { success: true, stagingDir: getStagingBaseDir() };
  });

  // Remote default branch auto-detection
  ipcMain.handle('detect-branch', async (_, gitUrl: string) => {
    return await gitService.detectRemoteDefaultBranch(gitUrl);
  });

  // Get local persistent repo history
  ipcMain.handle('get-history', async () => {
    return historyService.getHistory();
  });

  // Get generated review reports
  ipcMain.handle('get-reports', async (_, commitSha: string) => {
    return await reportService.getReports(commitSha);
  });

  // Abort execution
  ipcMain.handle('abort-review', async () => {
    const success = agentInvoker.abortExecution();
    if (success) {
      sendStateUpdate({ stage: 'aborted', error: 'User aborted execution' });
    }
    return { success };
  });

  // Start code review orchestration pipeline
  ipcMain.handle('start-review', async (_, req: ReviewRequest) => {
    const { gitUrl, branch } = req;

    if (!gitUrl || !gitUrl.trim()) {
      return { success: false, error: 'Git URL is required' };
    }
    if (!branch || !branch.trim()) {
      return { success: false, error: 'Branch name is required' };
    }

    try {
      // 1. Stage: Fetching & Git sync
      sendStateUpdate({ stage: 'fetching', branch });
      sendLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Starting review pipeline for repository: ${gitUrl} (branch: ${branch})`,
      });

      const { commitSha, workspaceDir } = await gitService.prepareGitWorkspace(
        gitUrl,
        branch,
        sendLogEntry
      );

      // Save/update valid repo in persistent history after fetch/checkout succeeds
      historyService.addOrUpdateHistory({
        gitUrl,
        lastBranch: branch,
        lastCommitSha: commitSha,
      });

      // 2. Stage: Host Dependency Installation (npm install)
      sendStateUpdate({ stage: 'installing', branch, commitSha });
      await installService.installDependencies(workspaceDir, sendLogEntry);

      // 3. Stage: Staging preparation
      sendStateUpdate({ stage: 'staging', branch, commitSha });
      const { stagedDir } = stagingService.prepareStagingWorkspace(
        workspaceDir,
        gitUrl,
        branch,
        commitSha,
        sendLogEntry
      );

      // 3. Stage: Running agent
      sendStateUpdate({ stage: 'running', branch, commitSha });
      const result = await agentInvoker.runAgent(stagedDir, sendLogEntry);

      if (result.aborted) {
        sendStateUpdate({ stage: 'aborted', branch, commitSha, error: 'Review process aborted by user' });
        return { success: false, error: 'Aborted' };
      }

      if (!result.success) {
        sendStateUpdate({ stage: 'failed', branch, commitSha, error: result.error || 'Agent execution failed' });
        return { success: false, error: result.error || 'Agent execution failed' };
      }

      // 4. Stage: Completed
      sendStateUpdate({ stage: 'completed', branch, commitSha });
      sendLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Review completed successfully for SHA: ${commitSha}`,
      });

      return { success: true, commitSha };
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      sendLogEntry({
        timestamp: new Date().toISOString(),
        source: 'stderr',
        message: `[PIPELINE ERROR] ${errorMessage}`,
      });
      sendStateUpdate({ stage: 'failed', branch, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });
}
