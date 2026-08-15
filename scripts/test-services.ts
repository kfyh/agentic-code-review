import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historyService } from '../src/main/services/historyService';
import { stagingService } from '../src/main/services/stagingService';
import { reportService } from '../src/main/services/reportService';
import { gitService } from '../src/main/services/gitService';
import { HistoryService } from '../src/main/services/historyService';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('--- STARTING CODE REVIEW APP SERVICES VERIFICATION SUITE ---');

  // 1. Test HistoryService
  console.log('\n[1/4] Testing HistoryService...');
  const testHistoryPath = path.join(os.tmpdir(), `test_repo_history_${Date.now()}.json`);
  const testHistoryService = new HistoryService(testHistoryPath);

  assert(testHistoryService.getHistory().length === 0, 'Initial history should be empty');

  // Add items
  testHistoryService.addOrUpdateHistory({
    gitUrl: 'git@github.com:acme/backend.git',
    lastBranch: 'dev',
    lastReviewedAt: new Date(Date.now() - 10000).toISOString(),
  });

  testHistoryService.addOrUpdateHistory({
    gitUrl: 'git@github.com:org/repo.git',
    lastBranch: 'main',
    lastReviewedAt: new Date().toISOString(),
  });

  let history = testHistoryService.getHistory();
  assert(history.length === 2, 'History count should be 2');
  assert(history[0].gitUrl === 'git@github.com:org/repo.git', 'Most recent repo should be listed first');

  // Test update existing item move to top
  testHistoryService.addOrUpdateHistory({
    gitUrl: 'git@github.com:acme/backend.git',
    lastBranch: 'feature-x',
  });

  history = testHistoryService.getHistory();
  assert(history.length === 2, 'History count should still be 2 after updating existing repo');
  assert(history[0].gitUrl === 'git@github.com:acme/backend.git', 'Updated repo should move to front');
  assert(history[0].lastBranch === 'feature-x', 'Branch should be updated to feature-x');

  // Clean test history file
  if (fs.existsSync(testHistoryPath)) {
    fs.unlinkSync(testHistoryPath);
  }

  // 2. Test StagingService Exclusions & Context Generation
  console.log('\n[2/4] Testing StagingService...');
  const mockCommitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';
  const mockWorkspaceDir = path.join(os.tmpdir(), `mock_workspace_${Date.now()}`);
  
  // Create dummy workspace structure
  fs.mkdirSync(path.join(mockWorkspaceDir, '.git'), { recursive: true });
  fs.mkdirSync(path.join(mockWorkspaceDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(mockWorkspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main');
  fs.writeFileSync(path.join(mockWorkspaceDir, 'CLAUDE.md'), '# Claude Config (Injection Vector)');
  fs.writeFileSync(path.join(mockWorkspaceDir, 'src', 'index.ts'), 'console.log("hello world");');
  fs.writeFileSync(path.join(mockWorkspaceDir, 'README.md'), '# Project Readme');

  const logs: string[] = [];
  const { stagedDir, contextJsonPath } = stagingService.prepareStagingWorkspace(
    mockWorkspaceDir,
    'git@github.com:org/repo.git',
    'main',
    mockCommitSha,
    (entry) => logs.push(entry.message)
  );

  assert(fs.existsSync(stagedDir), 'Staged directory should exist');
  assert(fs.existsSync(contextJsonPath), 'context.json should exist');
  assert(fs.existsSync(path.join(stagedDir, 'src', 'index.ts')), 'Source files should be copied to staged dir');
  assert(fs.existsSync(path.join(stagedDir, 'README.md')), 'README.md should be copied to staged dir');

  // SECURITY VERIFICATION: .git and CLAUDE.md MUST BE EXCLUDED!
  assert(!fs.existsSync(path.join(stagedDir, '.git')), 'SECURITY CHECK PASS: .git/ directory MUST be excluded from staging!');
  assert(!fs.existsSync(path.join(stagedDir, 'CLAUDE.md')), 'SECURITY CHECK PASS: CLAUDE.md MUST be excluded from staging!');

  // Verify context.json content
  const contextData = JSON.parse(fs.readFileSync(contextJsonPath, 'utf-8'));
  assert(contextData.repoUrl === 'git@github.com:org/repo.git', 'context.json repoUrl match');
  assert(contextData.branch === 'main', 'context.json branch match');
  assert(contextData.commitSha === mockCommitSha, 'context.json commitSha match');

  // 3. Test ReportService
  console.log('\n[3/4] Testing ReportService Multi-Location Discovery...');
  const reportsDir = path.join(stagedDir, 'reports');
  const outputDir = path.join(stagedDir, 'output');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  // Add report in reports/
  fs.writeFileSync(
    path.join(reportsDir, 'pkg-a_code_smells.md'),
    '# Code Smell Analysis for pkg-a\n\n- Found circular dependency in src/utils'
  );

  // Add report in output/
  fs.writeFileSync(
    path.join(outputDir, 'pkg-b_code_smells.md'),
    '# Code Smell Analysis for pkg-b\n\n- Missing error boundary'
  );

  // Add root report fallback
  fs.writeFileSync(
    path.join(stagedDir, 'root_code_smells.md'),
    '# Code Smell Analysis for Root Package\n\n- Single package analysis report'
  );

  // Add un-related markdown file (should be ignored)
  fs.writeFileSync(
    path.join(stagedDir, 'README.md'),
    '# Ignored README'
  );

  const reports = await reportService.getReports(mockCommitSha);
  assert(reports.length === 3, 'Should load 3 markdown reports from reports/, output/, and root fallback');
  const packageNames = reports.map((r) => r.packageName);
  assert(packageNames.includes('pkg-a_code_smells'), 'Discovered report in reports/ directory');
  assert(packageNames.includes('pkg-b_code_smells'), 'Discovered report in output/ directory');
  assert(packageNames.includes('root_code_smells'), 'Discovered root fallback report file');
  assert(!packageNames.includes('README'), 'Successfully ignored README.md file');

  // Clean mock directories
  fs.rmSync(mockWorkspaceDir, { recursive: true, force: true });
  fs.rmSync(stagedDir, { recursive: true, force: true });

  // 4. Test GitService Default Branch Query Fallback
  console.log('\n[4/5] Testing GitService Fallback Behavior...');
  const branchResult = await gitService.detectRemoteDefaultBranch('invalid-git-url-12345');
  assert(branchResult.branch === 'main', 'Default branch fallback should return "main"');
  assert(branchResult.isFallback === true, 'isFallback flag should be true for invalid URL');

  // 5. Test InstallService
  console.log('\n[5/6] Testing InstallService...');
  const { installService } = await import('../src/main/services/installService');
  const dummyDirWithoutPkg = path.join(os.tmpdir(), `dummy_no_pkg_${Date.now()}`);
  fs.mkdirSync(dummyDirWithoutPkg, { recursive: true });
  const installRes = await installService.installDependencies(dummyDirWithoutPkg);
  assert(installRes.success === true, 'InstallService should succeed when package.json is absent');
  assert(installRes.installed === false, 'installed flag should be false when package.json is absent');
  fs.rmSync(dummyDirWithoutPkg, { recursive: true, force: true });

  // 6. Test Staging Folder Config & Hidden .agentic-code-review Directory Path
  console.log('\n[6/6] Testing Configurable Staging Directory...');
  const { getStagingBaseDir, setStagingDir, getStagedDir, getBaseAppDir } = await import('../src/main/config');

  // Verify default staging dir is inside .agentic-code-review/staged
  const defaultStaging = getStagingBaseDir();
  assert(defaultStaging === path.join(os.homedir(), '.agentic-code-review', 'staged'), 'Default staging dir should be in ~/.agentic-code-review/staged');

  // Verify getBaseAppDir uses .agentic-code-review
  const baseAppDir = getBaseAppDir();
  assert(baseAppDir === path.join(os.homedir(), '.agentic-code-review'), 'Base app dir should be ~/.agentic-code-review');

  // Verify custom staging dir configuration
  const customPath = path.join(os.tmpdir(), 'custom_staging_folder');
  setStagingDir(customPath);
  assert(getStagingBaseDir() === customPath, 'getStagingBaseDir should return custom configured path');
  assert(getStagedDir('testsha123') === path.join(customPath, 'testsha123'), 'getStagedDir should use custom staging base path');

  // Reset custom path
  setStagingDir(null);
  assert(getStagingBaseDir() === path.join(os.homedir(), '.agentic-code-review', 'staged'), 'Resetting custom path should revert to default staging dir');

  console.log('\n🎉 ALL SERVICE VERIFICATION CHECKS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
