import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReportService } from '../src/main/services/reportService';
import { setStagingDir } from '../src/main/config';

describe('ReportService', () => {
  let customStagingBase: string;
  let reportService: ReportService;
  const mockCommitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';

  beforeEach(() => {
    reportService = new ReportService();
    customStagingBase = path.join(
      os.tmpdir(),
      `jest_reports_staging_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    setStagingDir(customStagingBase);
  });

  afterEach(() => {
    setStagingDir(null);
    if (fs.existsSync(customStagingBase)) {
      fs.rmSync(customStagingBase, { recursive: true, force: true });
    }
  });

  test('scans and loads reports from reports/, output/, and root fallback', async () => {
    const stagedDir = path.join(customStagingBase, mockCommitSha);
    const reportsDir = path.join(stagedDir, 'reports');
    const outputDir = path.join(stagedDir, 'output');

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(
      path.join(reportsDir, 'pkg-a_code_smells.md'),
      '# Code Smell Analysis for pkg-a'
    );
    fs.writeFileSync(
      path.join(outputDir, 'pkg-b_code_smells.md'),
      '# Code Smell Analysis for pkg-b'
    );
    fs.writeFileSync(path.join(stagedDir, 'root_code_smells.md'), '# Root Code Smell Analysis');
    fs.writeFileSync(path.join(stagedDir, 'README.md'), '# Ignored Readme');

    const reports = await reportService.getReports(mockCommitSha);
    expect(reports.length).toBe(3);

    const packageNames = reports.map((r) => r.packageName);
    expect(packageNames).toContain('pkg-a_code_smells');
    expect(packageNames).toContain('pkg-b_code_smells');
    expect(packageNames).toContain('root_code_smells');
    expect(packageNames).not.toContain('README');
  });

  test('returns empty array if staged directory does not exist', async () => {
    const reports = await reportService.getReports('non_existent_sha_123');
    expect(reports).toEqual([]);
  });

  test('falls back to candidate search dirs if no reports directly in staged dir', async () => {
    const stagedDir = path.join(customStagingBase, mockCommitSha);
    fs.mkdirSync(stagedDir, { recursive: true });

    const brainDir = path.join(os.homedir(), '.gemini/antigravity-cli/brain');
    const testBrainDir = path.join(brainDir, `test_session_${Date.now()}`);
    fs.mkdirSync(testBrainDir, { recursive: true });
    const fallbackReportFile = path.join(testBrainDir, 'test_fallback_code_smells.md');
    fs.writeFileSync(fallbackReportFile, '# Fallback Code Smells Report Content');

    const reports = await reportService.getReports(mockCommitSha);
    expect(reports.length).toBeGreaterThan(0);

    // Clean up test file
    fs.rmSync(testBrainDir, { recursive: true, force: true });
  });

  test('extracts report from stdout stream and saves to file', () => {
    const stagedDir = path.join(customStagingBase, mockCommitSha);
    fs.mkdirSync(stagedDir, { recursive: true });

    const logs: string[] = [];
    const stdoutLines = [
      'Some agent header line',
      '# Code Smell Analysis',
      '## 1. Executive Summary',
      'Complexity finding',
      '🏁 Session Finished',
    ];

    const extracted = reportService.extractReportFromStdout(stdoutLines, stagedDir, (msg) =>
      logs.push(msg)
    );
    expect(extracted).toBe(true);

    const reportPath = path.join(stagedDir, 'reports', 'code_smells.md');
    expect(fs.existsSync(reportPath)).toBe(true);
    expect(fs.readFileSync(reportPath, 'utf-8')).toContain('# Code Smell Analysis');
  });

  test('extractReportFromStdout returns true if existing valid report files already present', () => {
    const stagedDir = path.join(customStagingBase, mockCommitSha);
    const reportsDir = path.join(stagedDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'code_smells.md'), '# Existing Report File Data');

    const extracted = reportService.extractReportFromStdout(['# Code Smell Analysis'], stagedDir);
    expect(extracted).toBe(true);
  });

  test('extractReportFromStdout returns false if no markdown report header found', () => {
    const stagedDir = path.join(customStagingBase, mockCommitSha);
    fs.mkdirSync(stagedDir, { recursive: true });

    const extracted = reportService.extractReportFromStdout(['line 1', 'line 2'], stagedDir);
    expect(extracted).toBe(false);
  });
});
