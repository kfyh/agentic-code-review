import fs from 'node:fs';
import path from 'node:path';
import { injectable, inject } from 'tsyringe';
import { DiffReviewRequest, LogEntry, ReviewRequest, ReviewStateUpdate } from '../../shared/types';
import { isError } from '../../shared/typeGuards';
import { getDiffPromptFilePath } from '../config';
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

  /**
   * Executes the Flow 2 PR / Branch Diff Review pipeline step-by-step.
   */
  public async executeDiffPipeline(
    req: DiffReviewRequest,
    onStateUpdate: (update: ReviewStateUpdate) => void,
    onLogEntry: (log: LogEntry) => void
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const { gitUrl, baseBranch, compareBranch, changeSpec } = req;

    if (!gitUrl || !gitUrl.trim()) {
      return { success: false, error: 'Git URL is required' };
    }
    if (!baseBranch || !baseBranch.trim()) {
      return { success: false, error: 'Base branch name is required' };
    }
    if (!compareBranch || !compareBranch.trim()) {
      return { success: false, error: 'Compare branch name is required' };
    }

    try {
      // 1. Fetching & Git sync stage for base and compare branches
      onStateUpdate({ stage: 'fetching', branch: compareBranch });
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Starting diff review pipeline: ${gitUrl} (Base: ${baseBranch} vs Compare: ${compareBranch})`,
      });

      const { baseCommitSha, compareCommitSha, workspaceDir } =
        await this.gitSvc.prepareDiffGitWorkspace(gitUrl, baseBranch, compareBranch, onLogEntry);

      this.historySvc.addOrUpdateHistory({
        gitUrl,
        lastBranch: compareBranch,
        lastCommitSha: compareCommitSha,
      });

      // 2. Host Dependency Installation stage on both base and compare workspaces
      onStateUpdate({ stage: 'installing', branch: compareBranch, commitSha: compareCommitSha });
      const baseDir = path.join(workspaceDir, 'base');
      const compareDir = path.join(workspaceDir, 'compare');
      await this.installSvc.installDependencies(baseDir, onLogEntry);
      await this.installSvc.installDependencies(compareDir, onLogEntry);

      // 3. Staging stage
      onStateUpdate({ stage: 'staging', branch: compareBranch, commitSha: compareCommitSha });
      const { stagedDir } = this.stagingSvc.prepareDiffStagingWorkspace(
        workspaceDir,
        gitUrl,
        baseBranch,
        compareBranch,
        changeSpec || '',
        baseCommitSha,
        compareCommitSha,
        onLogEntry
      );

      // 4. Load & Merge Diff Prompt
      const diffPromptPath = getDiffPromptFilePath();
      let promptTemplate = '';
      if (fs.existsSync(diffPromptPath)) {
        promptTemplate = fs.readFileSync(diffPromptPath, 'utf-8');
      } else {
        promptTemplate = `# PR & Diff Code Review\n\nTarget Change Specification:\n\n{{CHANGE_SPEC}}\n`;
      }

      const specContent =
        changeSpec && changeSpec.trim()
          ? changeSpec.trim()
          : 'No explicit Change Specification provided. Conduct a general PR diff code review.';

      const mergedPrompt = promptTemplate.replace('{{CHANGE_SPEC}}', () => specContent);

      // 5. Agent execution stage
      onStateUpdate({ stage: 'running', branch: compareBranch, commitSha: compareCommitSha });
      const agentRes = await this.agentInv.runAgent(stagedDir, onLogEntry, mergedPrompt);

      if (agentRes.aborted) {
        onStateUpdate({
          stage: 'aborted',
          branch: compareBranch,
          commitSha: compareCommitSha,
          error: 'Review process aborted by user',
        });
        return { success: false, error: 'Aborted' };
      }

      if (!agentRes.success) {
        onStateUpdate({
          stage: 'failed',
          branch: compareBranch,
          commitSha: compareCommitSha,
          error: agentRes.error || 'Agent execution failed',
        });
        return { success: false, error: agentRes.error || 'Agent execution failed' };
      }

      // 6. Completion stage
      onStateUpdate({ stage: 'completed', branch: compareBranch, commitSha: compareCommitSha });
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'app',
        message: `Diff review completed successfully for SHA: ${compareCommitSha}`,
      });

      return { success: true, commitSha: compareCommitSha };
    } catch (err: unknown) {
      const errorMessage = isError(err) ? err.message : String(err);
      onLogEntry({
        timestamp: new Date().toISOString(),
        source: 'stderr',
        message: `[DIFF PIPELINE ERROR] ${errorMessage}`,
      });
      onStateUpdate({ stage: 'failed', branch: compareBranch, error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}
