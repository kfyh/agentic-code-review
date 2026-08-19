import 'reflect-metadata';
import { setupIpcHandlers } from '../src/main/ipc';
import { ServiceContainer } from '../src/main/services/container';
import { GitService } from '../src/main/services/gitService';
import { HistoryService } from '../src/main/services/historyService';
import { InstallService } from '../src/main/services/installService';
import { StagingService } from '../src/main/services/stagingService';
import { ReportService } from '../src/main/services/reportService';
import { AgentInvoker } from '../src/main/services/agentInvoker';
import { StdoutReportParser } from '../src/main/services/stdoutReportParser';
import { ReviewPipelineRunner } from '../src/main/services/reviewPipelineRunner';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import { ipcMain } from 'electron';

describe('IPC Handlers', () => {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  let mockWindow: { isDestroyed: jest.Mock; webContents: { send: jest.Mock } };
  let mockGitService: Partial<GitService>;
  let mockHistoryService: Partial<HistoryService>;
  let mockInstallService: Partial<InstallService>;
  let mockStagingService: Partial<StagingService>;
  let mockReportService: Partial<ReportService>;
  let mockAgentInvoker: Partial<AgentInvoker>;
  let services: ServiceContainer;

  beforeEach(() => {
    handlers = {};
    mockWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: {
        send: jest.fn(),
      },
    };

    (ipcMain.handle as jest.Mock).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
      }
    );

    mockGitService = {
      detectRemoteDefaultBranch: jest.fn().mockResolvedValue({ branch: 'main', isFallback: false }),
      prepareGitWorkspace: jest.fn().mockResolvedValue({
        commitSha: '84923bd151f6d5d77dd19392667a1c34f476ebaa',
        workspaceDir: '/tmp/workspace/sha123',
      }),
    };
    mockHistoryService = {
      getHistory: jest.fn().mockReturnValue([]),
      addOrUpdateHistory: jest.fn(),
    };
    mockInstallService = {
      installDependencies: jest.fn().mockResolvedValue({ success: true, installed: true }),
    };
    mockStagingService = {
      prepareStagingWorkspace: jest.fn().mockReturnValue({
        stagedDir: '/tmp/staged/sha123',
        contextJsonPath: '/tmp/staged/sha123/context.json',
      }),
    };
    mockReportService = {
      getReports: jest.fn().mockResolvedValue([]),
    };
    mockAgentInvoker = {
      abortExecution: jest.fn().mockReturnValue(true),
      runAgent: jest.fn().mockResolvedValue({ success: true }),
    };

    const runner = new ReviewPipelineRunner(
      mockGitService as GitService,
      mockHistoryService as HistoryService,
      mockInstallService as InstallService,
      mockStagingService as StagingService,
      mockAgentInvoker as AgentInvoker
    );

    services = {
      gitService: mockGitService as GitService,
      historyService: mockHistoryService as HistoryService,
      installService: mockInstallService as InstallService,
      stagingService: mockStagingService as StagingService,
      reportService: mockReportService as ReportService,
      agentInvoker: mockAgentInvoker as AgentInvoker,
      stdoutReportParser: {} as unknown as StdoutReportParser,
      reviewPipelineRunner: runner,
    };

    setupIpcHandlers(services, () => mockWindow as unknown as Electron.BrowserWindow);
  });

  test('registers all required IPC channels', () => {
    expect(handlers[IPC_CHANNELS.GET_STAGING_DIR]).toBeDefined();
    expect(handlers[IPC_CHANNELS.SET_STAGING_DIR]).toBeDefined();
    expect(handlers[IPC_CHANNELS.DETECT_BRANCH]).toBeDefined();
    expect(handlers[IPC_CHANNELS.GET_HISTORY]).toBeDefined();
    expect(handlers[IPC_CHANNELS.GET_REPORTS]).toBeDefined();
    expect(handlers[IPC_CHANNELS.ABORT_REVIEW]).toBeDefined();
    expect(handlers[IPC_CHANNELS.START_REVIEW]).toBeDefined();
  });

  test('handles get-staging-dir and set-staging-dir IPC calls', async () => {
    const dir = await handlers[IPC_CHANNELS.GET_STAGING_DIR]();
    expect(dir).toBeTruthy();

    const setRes = (await handlers[IPC_CHANNELS.SET_STAGING_DIR](
      null,
      '/tmp/custom_ipc_staging'
    )) as {
      success: boolean;
      stagingDir: string;
    };
    expect(setRes.success).toBe(true);
    expect(setRes.stagingDir).toBe('/tmp/custom_ipc_staging');
  });

  test('handles get-history and get-reports IPC calls', async () => {
    const history = await handlers[IPC_CHANNELS.GET_HISTORY]();
    expect(Array.isArray(history)).toBe(true);

    const reports = await handlers[IPC_CHANNELS.GET_REPORTS](null, 'sha123');
    expect(Array.isArray(reports)).toBe(true);
  });

  test('handles detect-branch IPC call', async () => {
    const res = (await handlers[IPC_CHANNELS.DETECT_BRANCH](
      null,
      'git@github.com:org/repo.git'
    )) as {
      branch: string;
    };
    expect(res.branch).toBeTruthy();
  });

  test('handles abort-review IPC call when active process exists', async () => {
    const res = (await handlers[IPC_CHANNELS.ABORT_REVIEW]()) as { success: boolean };
    expect(res.success).toBe(true);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.REVIEW_STATE_UPDATE, {
      stage: 'aborted',
      error: 'User aborted execution',
    });
  });

  test('handles start-review IPC call and sends webContents updates', async () => {
    const res = (await handlers[IPC_CHANNELS.START_REVIEW](null, {
      gitUrl: 'git@github.com:org/repo.git',
      branch: 'main',
    })) as { success: boolean };
    expect(res.success).toBe(true);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.LOG_ENTRY,
      expect.anything()
    );
  });

  test('handles start-diff-review IPC call and sends webContents updates', async () => {
    (mockGitService as Record<string, unknown>).prepareDiffGitWorkspace = jest
      .fn()
      .mockResolvedValue({
        baseCommitSha: '1111111111111111111111111111111111111111',
        compareCommitSha: '2222222222222222222222222222222222222222',
        workspaceDir: '/tmp/workspace/diff-123',
      });
    (mockStagingService as Record<string, unknown>).prepareDiffStagingWorkspace = jest
      .fn()
      .mockReturnValue({
        stagedDir: '/tmp/staged/diff-123',
        contextJsonPath: '/tmp/staged/diff-123/context.json',
      });

    const res = (await handlers[IPC_CHANNELS.START_DIFF_REVIEW](null, {
      gitUrl: 'git@github.com:org/repo.git',
      baseBranch: 'main',
      compareBranch: 'feature/pr-1',
      changeSpec: 'Review change spec',
    })) as { success: boolean; commitSha?: string };

    expect(res.success).toBe(true);
    expect(res.commitSha).toBe('2222222222222222222222222222222222222222');
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.REVIEW_STATE_UPDATE,
      expect.objectContaining({ stage: 'completed' })
    );
  });

  test('handles get-branches IPC call', async () => {
    (mockGitService as Record<string, unknown>).getRemoteBranches = jest.fn().mockResolvedValue({
      success: true,
      branches: ['main', 'develop'],
    });

    const res = (await handlers[IPC_CHANNELS.GET_BRANCHES](
      null,
      'git@github.com:org/repo.git'
    )) as {
      success: boolean;
      branches: string[];
    };
    expect(res.success).toBe(true);
    expect(res.branches).toEqual(['main', 'develop']);
  });

  test('ignores sendStateUpdate and sendLogEntry if window is destroyed', async () => {
    mockWindow.isDestroyed.mockReturnValue(true);
    const res = (await handlers[IPC_CHANNELS.START_REVIEW](null, { gitUrl: '', branch: '' })) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
  });
});
