export * from './ipcChannels';

export interface HistoryEntry {
  gitUrl: string;
  lastBranch: string;
  lastCommitSha?: string;
  lastReviewedAt: string;
}

export interface ReviewRequest {
  gitUrl: string;
  branch: string;
}

export type ReviewStage =
  'idle' | 'fetching' | 'installing' | 'staging' | 'running' | 'completed' | 'failed' | 'aborted';

export interface LogEntry {
  timestamp: string;
  source: 'app' | 'git' | 'install' | 'staging' | 'agent' | 'stderr';
  message: string;
}

export interface ReviewReport {
  packageName: string;
  filePath: string;
  content: string;
}

export interface ReviewStateUpdate {
  stage: ReviewStage;
  branch?: string;
  commitSha?: string;
  error?: string;
}

export interface DetectBranchResult {
  success: boolean;
  branch: string;
  isFallback?: boolean;
  error?: string;
}

export interface WindowApi {
  detectBranch: (gitUrl: string) => Promise<DetectBranchResult>;
  startReview: (
    req: ReviewRequest
  ) => Promise<{ success: boolean; commitSha?: string; error?: string }>;
  abortReview: () => Promise<{ success: boolean }>;
  getHistory: () => Promise<HistoryEntry[]>;
  getReports: (commitSha: string) => Promise<ReviewReport[]>;
  getStagingDir: () => Promise<string>;
  setStagingDir: (dir: string) => Promise<{ success: boolean; stagingDir: string }>;
  onStateUpdate: (callback: (update: ReviewStateUpdate) => void) => () => void;
  onLogEntry: (callback: (log: LogEntry) => void) => () => void;
}

declare global {
  interface Window {
    api: WindowApi;
  }
}
