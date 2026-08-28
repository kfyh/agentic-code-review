import { BrowserWindow, ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  LogEntry,
  ReviewRequest,
  DiffReviewRequest,
  ReviewStateUpdate,
} from '../shared/types';
import { ServiceContainer } from './services/container';
import { getStagingBaseDir, setStagingDir } from './config';

export function setupIpcHandlers(
  services: ServiceContainer,
  getMainWindow: () => BrowserWindow | null
): void {
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
    return await services.gitService.detectRemoteDefaultBranch(gitUrl);
  });

  // Get remote branches list
  ipcMain.handle(IPC_CHANNELS.GET_BRANCHES, async (_, gitUrl: string) => {
    return await services.gitService.getRemoteBranches(gitUrl);
  });

  // Get local persistent repo history
  ipcMain.handle(IPC_CHANNELS.GET_HISTORY, async () => {
    return services.historyService.getHistory();
  });

  // Get generated review reports
  ipcMain.handle(IPC_CHANNELS.GET_REPORTS, async (_, branchOrKey: string) => {
    return await services.reportService.getReports(branchOrKey);
  });

  // Abort execution
  ipcMain.handle(IPC_CHANNELS.ABORT_REVIEW, async () => {
    const success = services.agentInvoker.abortExecution();
    if (success) {
      sendStateUpdate({ stage: 'aborted', error: 'User aborted execution' });
    }
    return { success };
  });

  // Start single code review orchestration pipeline
  ipcMain.handle(IPC_CHANNELS.START_REVIEW, async (_, req: ReviewRequest) => {
    return await services.reviewPipelineRunner.executePipeline(req, sendStateUpdate, sendLogEntry);
  });

  // Start PR / diff review orchestration pipeline
  ipcMain.handle(IPC_CHANNELS.START_DIFF_REVIEW, async (_, req: DiffReviewRequest) => {
    return await services.reviewPipelineRunner.executeDiffPipeline(
      req,
      sendStateUpdate,
      sendLogEntry
    );
  });
}
