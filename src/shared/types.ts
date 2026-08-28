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

export interface DiffReviewRequest {
  gitUrl: string;
  baseBranch: string;
  compareBranch: string;
  changeSpec: string;
}

export type ReviewMode = 'single' | 'diff';

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

export interface GetBranchesResult {
  success: boolean;
  branches: string[];
  error?: string;
}

// Segregated interfaces for Interface Segregation Principle (ISP)
export interface HistoryApi {
  getHistory: () => Promise<HistoryEntry[]>;
}

export interface ReportsApi {
  getReports: (branchOrKey: string) => Promise<ReviewReport[]>;
}

export interface PipelineApi {
  startReview: (
    req: ReviewRequest
  ) => Promise<{ success: boolean; commitSha?: string; error?: string }>;
  startDiffReview: (
    req: DiffReviewRequest
  ) => Promise<{ success: boolean; commitSha?: string; error?: string }>;
  abortReview: () => Promise<{ success: boolean }>;
  onStateUpdate: (callback: (update: ReviewStateUpdate) => void) => () => void;
  onLogEntry: (callback: (log: LogEntry) => void) => () => void;
}

export interface ConfigApi {
  detectBranch: (gitUrl: string) => Promise<DetectBranchResult>;
  getBranches: (gitUrl: string) => Promise<GetBranchesResult>;
  getStagingDir: () => Promise<string>;
  setStagingDir: (dir: string) => Promise<{ success: boolean; stagingDir: string }>;
}

export interface WindowApi extends HistoryApi, ReportsApi, PipelineApi, ConfigApi {}

declare global {
  interface Window {
    api: WindowApi;
  }
}
