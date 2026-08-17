import { LogEntry, ReviewRequest, ReviewStateUpdate } from '../../shared/types';
import { agentInvoker, AgentInvoker } from './agentInvoker';
import { gitService, GitService } from './gitService';
import { historyService, HistoryService } from './historyService';
import { installService, InstallService } from './installService';
import { stagingService, StagingService } from './stagingService';

export class ReviewPipelineRunner {
  constructor(
    private gitSvc: GitService = gitService,
    private historySvc: HistoryService = historyService,
    private installSvc: InstallService = installService,
    private stagingSvc: StagingService = stagingService,
    private agentInv: AgentInvoker = agentInvoker
  ) {}

  /**
   * Executes the full code review pipeline step-by-step.
   */
  public async executePipeline(
    req: ReviewRequest,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const { gitUrl, branch } = req;

    if (!gitUrl || !gitUrl.trim()) {
      return { success: false, error: 'Git URL is required' };
    }
    if (!branch || !branch.trim()) {
      return { success: false, error: 'Branch name is required' };
    }

    try {
      // 1. Stage: Fetching & Git sync
      onStateUpdate({ stage: 'fetching', branch });
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Starting review pipeline for repository: ${gitUrl} (branch: ${branch})`,
      });

      const { commitSha, workspaceDir } = await this.gitSvc.prepareGitWorkspace(
        gitUrl,
        branch,
        onLogEntry
      );

      this.historySvc.addOrUpdateHistory({
        gitUrl,
        lastBranch: branch,
        lastCommitSha: commitSha,
      });

      // 2. Stage: Host Dependency Installation (npm install)
      onStateUpdate({ stage: 'installing', branch, commitSha });
      await this.installSvc.installDependencies(workspaceDir, onLogEntry);

      // 3. Stage: Staging preparation
      onStateUpdate({ stage: 'staging', branch, commitSha });
      const { stagedDir } = this.stagingSvc.prepareStagingWorkspace(
        workspaceDir,
        gitUrl,
        branch,
        commitSha,
        onLogEntry
      );

      // 4. Stage: Running agent
      onStateUpdate({ stage: 'running', branch, commitSha });
      const result = await this.agentInv.runAgent(stagedDir, onLogEntry);

      if (result.aborted) {
        onStateUpdate({
          stage: 'aborted',
          branch,
          commitSha,
          error: 'Review process aborted by user',
        });
        return { success: false, error: 'Aborted' };
      }

      if (!result.success) {
        onStateUpdate({
          stage: 'failed',
          branch,
          commitSha,
          error: result.error || 'Agent execution failed',
        });
        return { success: false, error: result.error || 'Agent execution failed' };
      }

      // 5. Stage: Completed
      onStateUpdate({ stage: 'completed', branch, commitSha });
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Review completed successfully for SHA: ${commitSha}`,
      });

      return { success: true, commitSha };
    } catch (err: unknown) {
      const errorMessage = (err as Error)?.message || String(err);
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'stderr',
        message: `[PIPELINE ERROR] ${errorMessage}`,
      });
      onStateUpdate({ stage: 'failed', branch, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}

export const reviewPipelineRunner = new ReviewPipelineRunner();
