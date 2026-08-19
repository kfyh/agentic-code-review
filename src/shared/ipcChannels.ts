/**
 * Standardized IPC Channel identifiers for Electron IPC communication.
 * Grouped by domain/feature using standard namespaced naming conventions (domain:action).
 */
export const IPC_CHANNELS = {
  // Staging configuration
  GET_STAGING_DIR: 'staging:get-dir',
  SET_STAGING_DIR: 'staging:set-dir',

  // Git repository operations
  DETECT_BRANCH: 'git:detect-branch',

  // Local repository history
  GET_HISTORY: 'history:get',

  // Review reports retrieval
  GET_REPORTS: 'reports:get',

  // Review execution pipeline
  START_REVIEW: 'review:start',
  START_DIFF_REVIEW: 'review:start-diff',
  ABORT_REVIEW: 'review:abort',

  // Event channels (Main -> Renderer webContents streams)
  REVIEW_STATE_UPDATE: 'review:state-update',
  LOG_ENTRY: 'log:entry',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
