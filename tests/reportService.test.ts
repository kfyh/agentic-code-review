import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportService } from '../src/main/services/reportService';
import { setStagingDir } from '../src/main/config';

describe('ReportService', () => {
  let customStagingBase: string;
  const mockCommitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';

  beforeEach(() => {
    customStagingBase = path.join(os.tmpdir(), `jest_reports_staging_${Date.now()}_${Math.random().toString(36).substring(7)}`);
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

    fs.writeFileSync(path.join(reportsDir, 'pkg-a_code_smells.md'), '# Code Smell Analysis for pkg-a');
    fs.writeFileSync(path.join(outputDir, 'pkg-b_code_smells.md'), '# Code Smell Analysis for pkg-b');
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
});
