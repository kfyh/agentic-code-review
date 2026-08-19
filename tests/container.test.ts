import 'reflect-metadata';
import { createServiceContainer } from '../src/main/services/container';
import { GitService } from '../src/main/services/gitService';
import { HistoryService } from '../src/main/services/historyService';
import { InstallService } from '../src/main/services/installService';
import { StagingService } from '../src/main/services/stagingService';
import { ReportService } from '../src/main/services/reportService';
import { AgentInvoker } from '../src/main/services/agentInvoker';
import { StdoutReportParser } from '../src/main/services/stdoutReportParser';
import { ReviewPipelineRunner } from '../src/main/services/reviewPipelineRunner';

describe('Service Container', () => {
  test('createServiceContainer resolves all required services via TSyringe', () => {
    const services = createServiceContainer();

    expect(services.gitService).toBeInstanceOf(GitService);
    expect(services.historyService).toBeInstanceOf(HistoryService);
    expect(services.installService).toBeInstanceOf(InstallService);
    expect(services.stagingService).toBeInstanceOf(StagingService);
    expect(services.reportService).toBeInstanceOf(ReportService);
    expect(services.agentInvoker).toBeInstanceOf(AgentInvoker);
    expect(services.stdoutReportParser).toBeInstanceOf(StdoutReportParser);
    expect(services.reviewPipelineRunner).toBeInstanceOf(ReviewPipelineRunner);
  });
});
