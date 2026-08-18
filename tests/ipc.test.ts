import { setupIpcHandlers } from '../src/main/ipc';
import { agentInvoker } from '../src/main/services/agentInvoker';
import { gitService } from '../src/main/services/gitService';
import { installService } from '../src/main/services/installService';
import { stagingService } from '../src/main/services/stagingService';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import { ipcMain } from 'electron';

describe('IPC Handlers', () => {
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};
  let mockWindow: { isDestroyed: jest.Mock; webContents: { send: jest.Mock } };

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

    setupIpcHandlers(() => mockWindow as unknown as Electron.BrowserWindow);
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
    jest.spyOn(agentInvoker, 'abortExecution').mockReturnValue(true);
    const res = (await handlers[IPC_CHANNELS.ABORT_REVIEW]()) as { success: boolean };
    expect(res.success).toBe(true);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.REVIEW_STATE_UPDATE, {
      stage: 'aborted',
      error: 'User aborted execution',
    });
  });

  test('handles start-review IPC call and sends webContents updates', async () => {
    jest.spyOn(gitService, 'prepareGitWorkspace').mockResolvedValue({
      commitSha: '84923bd151f6d5d77dd19392667a1c34f476ebaa',
      workspaceDir: '/tmp/workspace/sha123',
    });
    jest
      .spyOn(installService, 'installDependencies')
      .mockResolvedValue({ success: true, installed: true });
    jest.spyOn(stagingService, 'prepareStagingWorkspace').mockReturnValue({
      stagedDir: '/tmp/staged/sha123',
      contextJsonPath: '/tmp/staged/sha123/context.json',
    });
    jest.spyOn(agentInvoker, 'runAgent').mockResolvedValue({ success: true });

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

  test('ignores sendStateUpdate and sendLogEntry if window is destroyed', async () => {
    mockWindow.isDestroyed.mockReturnValue(true);
    const res = (await handlers[IPC_CHANNELS.START_REVIEW](null, { gitUrl: '', branch: '' })) as {
      success: boolean;
    };
    expect(res.success).toBe(false);
  });
});
