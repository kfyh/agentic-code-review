import 'reflect-metadata';
import { ReviewPipelineRunner } from '../src/main/services/reviewPipelineRunner';
import { ReviewStateUpdate, LogEntry } from '../src/shared/types';
import { GitService } from '../src/main/services/gitService';
import { HistoryService } from '../src/main/services/historyService';
import { InstallService } from '../src/main/services/installService';
import { StagingService } from '../src/main/services/stagingService';
import { AgentInvoker } from '../src/main/services/agentInvoker';

describe('ReviewPipelineRunner', () => {
  let mockGitService: { prepareGitWorkspace: jest.Mock };
  let mockHistoryService: { addOrUpdateHistory: jest.Mock };
  let mockInstallService: { installDependencies: jest.Mock };
  let mockStagingService: { prepareStagingWorkspace: jest.Mock };
  let mockAgentInvoker: { runAgent: jest.Mock };
  let runner: ReviewPipelineRunner;

  beforeEach(() => {
    mockGitService = {
      prepareGitWorkspace: jest.fn().mockResolvedValue({
        commitSha: '84923bd151f6d5d77dd19392667a1c34f476ebaa',
        workspaceDir: '/tmp/workspace/84923bd151f6d5d77dd19392667a1c34f476ebaa',
      }),
    };
    mockHistoryService = {
      addOrUpdateHistory: jest.fn(),
    };
    mockInstallService = {
      installDependencies: jest.fn().mockResolvedValue({ success: true }),
    };
    mockStagingService = {
      prepareStagingWorkspace: jest.fn().mockReturnValue({
        stagedDir: '/tmp/staged/84923bd151f6d5d77dd19392667a1c34f476ebaa',
        contextJsonPath: '/tmp/staged/84923bd151f6d5d77dd19392667a1c34f476ebaa/context.json',
      }),
    };
    mockAgentInvoker = {
      runAgent: jest.fn().mockResolvedValue({ success: true }),
    };

    runner = new ReviewPipelineRunner(
      mockGitService as unknown as GitService,
      mockHistoryService as unknown as HistoryService,
      mockInstallService as unknown as InstallService,
      mockStagingService as unknown as StagingService,
      mockAgentInvoker as unknown as AgentInvoker
    );
  });

  test('validates required gitUrl and branch arguments', async () => {
    const onStateUpdate = jest.fn();
    const onLogEntry = jest.fn();

    const res1 = await runner.executePipeline(
      { gitUrl: '', branch: 'main' },
      onStateUpdate,
      onLogEntry
    );
    expect(res1.success).toBe(false);
    expect(res1.error).toBe('Git URL is required');

    const res2 = await runner.executePipeline(
      { gitUrl: 'git@github.com:org/repo.git', branch: '' },
      onStateUpdate,
      onLogEntry
    );
    expect(res2.success).toBe(false);
    expect(res2.error).toBe('Branch name is required');
  });

  test('executes end-to-end pipeline successfully through all stages', async () => {
    const stateUpdates: ReviewStateUpdate[] = [];
    const logs: LogEntry[] = [];

    const res = await runner.executePipeline(
      { gitUrl: 'git@github.com:org/repo.git', branch: 'main' },
      (u) => stateUpdates.push(u),
      (l) => logs.push(l)
    );

    expect(res.success).toBe(true);
    expect(res.commitSha).toBe('84923bd151f6d5d77dd19392667a1c34f476ebaa');

    const stages = stateUpdates.map((u) => u.stage);
    expect(stages).toEqual(['fetching', 'installing', 'staging', 'running', 'completed']);
    expect(mockHistoryService.addOrUpdateHistory).toHaveBeenCalledTimes(1);
  });

  test('handles agent abortion state', async () => {
    mockAgentInvoker.runAgent.mockResolvedValue({ success: false, aborted: true });
    const stateUpdates: ReviewStateUpdate[] = [];

    const res = await runner.executePipeline(
      { gitUrl: 'git@github.com:org/repo.git', branch: 'main' },
      (u) => stateUpdates.push(u),
      jest.fn()
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('Aborted');
    expect(stateUpdates[stateUpdates.length - 1].stage).toBe('aborted');
  });

  test('handles agent execution failure', async () => {
    mockAgentInvoker.runAgent.mockResolvedValue({
      success: false,
      error: 'Agent execution failed',
    });
    const stateUpdates: ReviewStateUpdate[] = [];

    const res = await runner.executePipeline(
      { gitUrl: 'git@github.com:org/repo.git', branch: 'main' },
      (u) => stateUpdates.push(u),
      jest.fn()
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('Agent execution failed');
    expect(stateUpdates[stateUpdates.length - 1].stage).toBe('failed');
  });

  test('handles unexpected service error', async () => {
    mockGitService.prepareGitWorkspace.mockRejectedValue(new Error('Git clone failed'));
    const stateUpdates: ReviewStateUpdate[] = [];

    const res = await runner.executePipeline(
      { gitUrl: 'git@github.com:org/repo.git', branch: 'main' },
      (u) => stateUpdates.push(u),
      jest.fn()
    );

    expect(res.success).toBe(false);
    expect(res.error).toBe('Git clone failed');
    expect(stateUpdates[stateUpdates.length - 1].stage).toBe('failed');
  });

  describe('executeDiffPipeline', () => {
    beforeEach(() => {
      (mockGitService as Record<string, unknown>).prepareDiffGitWorkspace = jest
        .fn()
        .mockResolvedValue({
          baseCommitSha: '1111111111111111111111111111111111111111',
          compareCommitSha: '2222222222222222222222222222222222222222',
          workspaceDir: '/tmp/workspace/diff-2222222222222222222222222222222222222222',
        });
      (mockStagingService as Record<string, unknown>).prepareDiffStagingWorkspace = jest
        .fn()
        .mockReturnValue({
          stagedDir: '/tmp/staged/diff-2222222222222222222222222222222222222222',
          contextJsonPath:
            '/tmp/staged/diff-2222222222222222222222222222222222222222/context.json',
        });
    });

    test('validates required arguments for diff pipeline', async () => {
      const onStateUpdate = jest.fn();
      const onLogEntry = jest.fn();

      const r1 = await runner.executeDiffPipeline(
        { gitUrl: '', baseBranch: 'main', compareBranch: 'feature', changeSpec: '' },
        onStateUpdate,
        onLogEntry
      );
      expect(r1.success).toBe(false);
      expect(r1.error).toBe('Git URL is required');

      const r2 = await runner.executeDiffPipeline(
        { gitUrl: 'git@github.com:org/repo.git', baseBranch: '', compareBranch: 'feature', changeSpec: '' },
        onStateUpdate,
        onLogEntry
      );
      expect(r2.success).toBe(false);
      expect(r2.error).toBe('Base branch name is required');

      const r3 = await runner.executeDiffPipeline(
        { gitUrl: 'git@github.com:org/repo.git', baseBranch: 'main', compareBranch: '', changeSpec: '' },
        onStateUpdate,
        onLogEntry
      );
      expect(r3.success).toBe(false);
      expect(r3.error).toBe('Compare branch name is required');
    });

    test('executes full diff pipeline successfully through all stages', async () => {
      const stateUpdates: ReviewStateUpdate[] = [];
      const logs: LogEntry[] = [];

      const res = await runner.executeDiffPipeline(
        {
          gitUrl: 'git@github.com:org/repo.git',
          baseBranch: 'main',
          compareBranch: 'feature/pr-1',
          changeSpec: 'Feature spec requirements',
        },
        (u) => stateUpdates.push(u),
        (l) => logs.push(l)
      );

      expect(res.success).toBe(true);
      expect(res.commitSha).toBe('2222222222222222222222222222222222222222');

      const stages = stateUpdates.map((u) => u.stage);
      expect(stages).toEqual(['fetching', 'installing', 'staging', 'running', 'completed']);
      expect(mockHistoryService.addOrUpdateHistory).toHaveBeenCalledTimes(1);
    });

    test('handles diff agent execution failure and abortion', async () => {
      mockAgentInvoker.runAgent.mockResolvedValueOnce({ success: false, aborted: true });
      const stateUpdates: ReviewStateUpdate[] = [];

      const abortRes = await runner.executeDiffPipeline(
        {
          gitUrl: 'git@github.com:org/repo.git',
          baseBranch: 'main',
          compareBranch: 'feature/pr-1',
          changeSpec: '',
        },
        (u) => stateUpdates.push(u),
        jest.fn()
      );
      expect(abortRes.success).toBe(false);
      expect(abortRes.error).toBe('Aborted');
      expect(stateUpdates[stateUpdates.length - 1].stage).toBe('aborted');

      mockAgentInvoker.runAgent.mockResolvedValueOnce({ success: false, error: 'Agent crash' });
      const failRes = await runner.executeDiffPipeline(
        {
          gitUrl: 'git@github.com:org/repo.git',
          baseBranch: 'main',
          compareBranch: 'feature/pr-1',
          changeSpec: '',
        },
        (u) => stateUpdates.push(u),
        jest.fn()
      );
      expect(failRes.success).toBe(false);
      expect(failRes.error).toBe('Agent crash');
      expect(stateUpdates[stateUpdates.length - 1].stage).toBe('failed');
    });
  });
});
