import { BrowserWindow, ipcMain } from 'electron';
import { LogEntry, ReviewRequest, ReviewStateUpdate } from '../shared/types';
import { agentInvoker } from './services/agentInvoker';
import { gitService } from './services/gitService';
import { historyService } from './services/historyService';
import { reportService } from './services/reportService';
import { reviewPipelineRunner } from './services/reviewPipelineRunner';
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
    return await reviewPipelineRunner.executePipeline(req, sendStateUpdate, sendLogEntry);
  });
}
