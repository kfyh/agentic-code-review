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
});
