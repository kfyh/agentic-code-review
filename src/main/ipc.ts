import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS, LogEntry, ReviewRequest, ReviewStateUpdate } from '../shared/types';
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
      win.webContents.send(IPC_CHANNELS.REVIEW_STATE_UPDATE, update);
    }
  };

  const sendLogEntry = (log: LogEntry) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.LOG_ENTRY, log);
    }
  };

  // Staging directory configuration handlers
  ipcMain.handle(IPC_CHANNELS.GET_STAGING_DIR, async () => {
    return getStagingBaseDir();
  });

  ipcMain.handle(IPC_CHANNELS.SET_STAGING_DIR, async (_, dir: string) => {
    setStagingDir(dir);
    return { success: true, stagingDir: getStagingBaseDir() };
  });

  // Remote default branch auto-detection
  ipcMain.handle(IPC_CHANNELS.DETECT_BRANCH, async (_, gitUrl: string) => {
    return await gitService.detectRemoteDefaultBranch(gitUrl);
  });

  // Get local persistent repo history
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    return historyService.getHistory();
  });

  // Get generated review reports
  ipcMain.handle(IPC_CHANNELS.GET_REPORTS, async (_, commitSha: string) => {
    return await reportService.getReports(commitSha);
  });

  // Abort execution
  ipcMain.handle(IPC_CHANNELS.ABORT_REVIEW, async () => {
    const success = agentInvoker.abortExecution();
    if (success) {
      sendStateUpdate({ stage: 'aborted', error: 'User aborted execution' });
    }
    return { success };
  });

  // Start code review orchestration pipeline
  ipcMain.handle(IPC_CHANNELS.START_REVIEW, async (_, req: ReviewRequest) => {
    return await reviewPipelineRunner.executePipeline(req, sendStateUpdate, sendLogEntry);
  });
}
