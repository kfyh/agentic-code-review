import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StagingService } from '../src/main/services/stagingService';
import { setStagingDir } from '../src/main/config';

describe('StagingService', () => {
  let stagingService: StagingService;
  let mockWorkspaceDir: string;
  let customStagingBase: string;
  const mockCommitSha = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';

  beforeEach(() => {
    stagingService = new StagingService();
    mockWorkspaceDir = path.join(
      os.tmpdir(),
      `jest_workspace_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    customStagingBase = path.join(
      os.tmpdir(),
      `jest_staging_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    setStagingDir(customStagingBase);

    // Create mock workspace directory structure
    fs.mkdirSync(path.join(mockWorkspaceDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(mockWorkspaceDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(mockWorkspaceDir, '.git', 'HEAD'), 'ref: refs/heads/main');
    fs.writeFileSync(path.join(mockWorkspaceDir, 'CLAUDE.md'), '# Claude Injection Vector');
    fs.writeFileSync(path.join(mockWorkspaceDir, 'src', 'index.ts'), 'console.log("hello world");');
    fs.writeFileSync(path.join(mockWorkspaceDir, 'README.md'), '# Project Readme');
  });

  afterEach(() => {
    setStagingDir(null);
    if (fs.existsSync(mockWorkspaceDir)) {
      fs.rmSync(mockWorkspaceDir, { recursive: true, force: true });
    }
    if (fs.existsSync(customStagingBase)) {
      fs.rmSync(customStagingBase, { recursive: true, force: true });
    }
  });

  test('prepares staging workspace and excludes .git/ and CLAUDE.md', () => {
    const logs: string[] = [];
    const { stagedDir, contextJsonPath } = stagingService.prepareStagingWorkspace(
      mockWorkspaceDir,
      'git@github.com:org/repo.git',
      'main',
      mockCommitSha,
      (entry) => logs.push(entry.message)
    );

    expect(fs.existsSync(stagedDir)).toBe(true);
    expect(fs.existsSync(contextJsonPath)).toBe(true);
    expect(fs.existsSync(path.join(stagedDir, 'src', 'index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(stagedDir, 'README.md'))).toBe(true);

    // Exclusions assertion
    expect(fs.existsSync(path.join(stagedDir, '.git'))).toBe(false);
    expect(fs.existsSync(path.join(stagedDir, 'CLAUDE.md'))).toBe(false);

    // Context metadata content check
    const contextData = JSON.parse(fs.readFileSync(contextJsonPath, 'utf-8'));
    expect(contextData.repoUrl).toBe('git@github.com:org/repo.git');
    expect(contextData.branch).toBe('main');
    expect(contextData.commitSha).toBe(mockCommitSha);
    expect(contextData.stagedAt).toBeTruthy();
  });

  test('cleans pre-existing staging directory when re-preparing', () => {
    const existingStaged = path.join(customStagingBase, mockCommitSha);
    fs.mkdirSync(existingStaged, { recursive: true });
    fs.writeFileSync(path.join(existingStaged, 'old_file.txt'), 'old data');

    const { stagedDir } = stagingService.prepareStagingWorkspace(
      mockWorkspaceDir,
      'git@github.com:org/repo.git',
      'main',
      mockCommitSha
    );

    expect(fs.existsSync(stagedDir)).toBe(true);
    expect(fs.existsSync(path.join(stagedDir, 'old_file.txt'))).toBe(false);
  });
});
