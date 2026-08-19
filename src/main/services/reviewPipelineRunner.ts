import { injectable, inject } from 'tsyringe';
import { LogEntry, ReviewRequest, ReviewStateUpdate } from '../../shared/types';
import { isError } from '../../shared/typeGuards';
import { AgentInvoker } from './agentInvoker';
import { GitService } from './gitService';
import { HistoryService } from './historyService';
import { InstallService } from './installService';
import { StagingService } from './stagingService';

@injectable()
export class ReviewPipelineRunner {
  constructor(
    @inject(GitService) private gitSvc: GitService,
    @inject(HistoryService) private historySvc: HistoryService,
    @inject(InstallService) private installSvc: InstallService,
    @inject(StagingService) private stagingSvc: StagingService,
    @inject(AgentInvoker) private agentInv: AgentInvoker
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
      // 1. Fetching & Git sync stage
      const { commitSha, workspaceDir } = await this.runFetchStage(
        gitUrl,
        branch,
        onStateUpdate,
        onLogEntry
      );

      // 2. Host Dependency Installation stage
      await this.runInstallStage(workspaceDir, branch, commitSha, onStateUpdate, onLogEntry);

      // 3. Staging stage
      const stagedDir = this.runStagingStage(
        workspaceDir,
        gitUrl,
        branch,
        commitSha,
        onStateUpdate,
        onLogEntry
      );

      // 4. Agent execution stage
      const agentRes = await this.runAgentStage(
        stagedDir,
        branch,
        commitSha,
        onStateUpdate,
        onLogEntry
      );

      if (!agentRes.success) {
        return agentRes;
      }

      // 5. Completion stage
      onStateUpdate({ stage: 'completed', branch, commitSha });
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Review completed successfully for SHA: ${commitSha}`,
      });

      return { success: true, commitSha };
    } catch (err: unknown) {
      const errorMessage = isError(err) ? err.message : String(err);
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'stderr',
        message: `[PIPELINE ERROR] ${errorMessage}`,
      });
      onStateUpdate({ stage: 'failed', branch, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  private async runFetchStage(
    gitUrl: string,
    branch: string,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): Promise<{ commitSha: string; workspaceDir: string }> {
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

    return { commitSha, workspaceDir };
  }

  private async runInstallStage(
    workspaceDir: string,
    branch: string,
    commitSha: string,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): Promise<void> {
    onStateUpdate({ stage: 'installing', branch, commitSha });
    await this.installSvc.installDependencies(workspaceDir, onLogEntry);
  }

  private runStagingStage(
    workspaceDir: string,
    gitUrl: string,
    branch: string,
    commitSha: string,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): string {
    onStateUpdate({ stage: 'staging', branch, commitSha });
    const { stagedDir } = this.stagingSvc.prepareStagingWorkspace(
      workspaceDir,
      gitUrl,
      branch,
      commitSha,
      onLogEntry
    );
    return stagedDir;
  }

  private async runAgentStage(
    stagedDir: string,
    branch: string,
    commitSha: string,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): Promise<{ success: boolean; error?: string }> {
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

    return { success: true };
  }
}
