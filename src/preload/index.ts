import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  LogEntry,
  ReviewRequest,
  DiffReviewRequest,
  ReviewStateUpdate,
  WindowApi,
} from '../shared/types';

const api: WindowApi = {
  detectBranch: (gitUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.DETECT_BRANCH, gitUrl),
  getBranches: (gitUrl: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_BRANCHES, gitUrl),
  startReview: (req: ReviewRequest) => ipcRenderer.invoke(IPC_CHANNELS.START_REVIEW, req),
  startDiffReview: (req: DiffReviewRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.START_DIFF_REVIEW, req),
  abortReview: () => ipcRenderer.invoke(IPC_CHANNELS.ABORT_REVIEW),
  getHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_HISTORY),
  getReports: (commitSha: string) => ipcRenderer.invoke(IPC_CHANNELS.GET_REPORTS, commitSha),
  getStagingDir: () => ipcRenderer.invoke(IPC_CHANNELS.GET_STAGING_DIR),
  setStagingDir: (dir: string) => ipcRenderer.invoke(IPC_CHANNELS.SET_STAGING_DIR, dir),

  onStateUpdate: (callback: (update: ReviewStateUpdate) => void) => {
    const subscription = (_: unknown, update: ReviewStateUpdate) => callback(update);
    ipcRenderer.on(IPC_CHANNELS.REVIEW_STATE_UPDATE, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.REVIEW_STATE_UPDATE, subscription);
    };
  },

  onLogEntry: (callback: (log: LogEntry) => void) => {
    const subscription = (_: unknown, log: LogEntry) => callback(log);
    ipcRenderer.on(IPC_CHANNELS.LOG_ENTRY, subscription);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LOG_ENTRY, subscription);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
