import { contextBridge, ipcRenderer } from 'electron';
import { LogEntry, ReviewRequest, ReviewStateUpdate, WindowApi } from '../shared/types';

const api: WindowApi = {
  detectBranch: (gitUrl: string) => ipcRenderer.invoke('detect-branch', gitUrl),
  startReview: (req: ReviewRequest) => ipcRenderer.invoke('start-review', req),
  abortReview: () => ipcRenderer.invoke('abort-review'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  getReports: (commitSha: string) => ipcRenderer.invoke('get-reports', commitSha),
  getStagingDir: () => ipcRenderer.invoke('get-staging-dir'),
  setStagingDir: (dir: string) => ipcRenderer.invoke('set-staging-dir', dir),

  onStateUpdate: (callback: (update: ReviewStateUpdate) => void) => {
    const subscription = (_: unknown, update: ReviewStateUpdate) => callback(update);
    ipcRenderer.on('review-state-update', subscription);
    return () => {
      ipcRenderer.removeListener('review-state-update', subscription);
    };
  },

  onLogEntry: (callback: (log: LogEntry) => void) => {
    const subscription = (_: unknown, log: LogEntry) => callback(log);
    ipcRenderer.on('log-entry', subscription);
    return () => {
      ipcRenderer.removeListener('log-entry', subscription);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
