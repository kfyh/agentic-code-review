import 'reflect-metadata';
import { container, DependencyContainer } from 'tsyringe';
import { AgentInvoker } from './agentInvoker';
import { GitService } from './gitService';
import { HistoryService } from './historyService';
import { InstallService } from './installService';
import { ReportService } from './reportService';
import { ReviewPipelineRunner } from './reviewPipelineRunner';
import { StagingService } from './stagingService';
import { StdoutReportParser } from './stdoutReportParser';

export interface ServiceContainer {
  gitService: GitService;
  historyService: HistoryService;
  installService: InstallService;
  stagingService: StagingService;
  reportService: ReportService;
  agentInvoker: AgentInvoker;
  stdoutReportParser: StdoutReportParser;
  reviewPipelineRunner: ReviewPipelineRunner;
}

export function createServiceContainer(c: DependencyContainer = container): ServiceContainer {
  if (!c.isRegistered(HistoryService)) {
    c.register(HistoryService, {
      useFactory: () => new HistoryService(),
    });
  }

  return {
    gitService: c.resolve(GitService),
    historyService: c.resolve(HistoryService),
    installService: c.resolve(InstallService),
    stagingService: c.resolve(StagingService),
    reportService: c.resolve(ReportService),
    agentInvoker: c.resolve(AgentInvoker),
    stdoutReportParser: c.resolve(StdoutReportParser),
    reviewPipelineRunner: c.resolve(ReviewPipelineRunner),
  };
}
