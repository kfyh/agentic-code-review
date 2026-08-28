import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import {
  getBaseAppDir,
  getUserDataDir,
  getStagingBaseDir,
  setStagingDir,
  getStagedDir,
  sanitizeBranchName,
  getHistoryFilePath,
  getGitCacheDir,
  getWorkspacesDir,
  getPromptFilePath,
  getDiffPromptFilePath,
} from '../src/main/config';

describe('Config Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    setStagingDir(null);
  });

  afterAll(() => {
    process.env = originalEnv;
    setStagingDir(null);
  });

  test('getBaseAppDir returns ~/.agentic-code-review', () => {
    const expected = path.join(os.homedir(), '.agentic-code-review');
    expect(getBaseAppDir()).toBe(expected);
  });

  test('getUserDataDir returns expected path', () => {
    const dir = getUserDataDir();
    expect(dir).toBeTruthy();
  });

  test('getUserDataDir returns fallback path if app.getPath throws', () => {
    const spy = jest.spyOn(app, 'getPath').mockImplementation(() => {
      throw new Error('Not ready');
    });
    const dir = getUserDataDir();
    expect(dir).toBe(path.join(os.homedir(), '.agentic-code-review'));
    spy.mockRestore();
  });

  test('getHistoryFilePath returns repo_history.json in userDataDir', () => {
    const historyPath = getHistoryFilePath();
    expect(historyPath).toBe(path.join(getUserDataDir(), 'repo_history.json'));
  });

  test('getGitCacheDir returns cache dir under base app dir', () => {
    expect(getGitCacheDir()).toBe(path.join(getBaseAppDir(), 'cache'));
  });

  test('getWorkspacesDir returns workspaces dir under base app dir', () => {
    expect(getWorkspacesDir()).toBe(path.join(getBaseAppDir(), 'workspaces'));
  });

  test('getStagingBaseDir returns default staged dir under base app dir', () => {
    expect(getStagingBaseDir()).toBe(path.join(getBaseAppDir(), 'staged'));
  });

  test('setStagingDir allows programmatically setting custom staging dir', () => {
    const customDir = '/tmp/custom_staging_test';
    setStagingDir(customDir);
    expect(getStagingBaseDir()).toBe(customDir);
    expect(getStagedDir('git@github.com:org/repo.git', 'sha123')).toContain(customDir);
    expect(getStagedDir('git@github.com:org/repo.git', 'feature/login')).toContain(customDir);
  });

  test('sanitizeBranchName replaces illegal characters with underscore and throws on empty', () => {
    expect(sanitizeBranchName('feature/login')).toBe('feature_login');
    expect(sanitizeBranchName('feature/nested/branch-name')).toBe('feature_nested_branch-name');
    expect(
      sanitizeBranchName('feat:add-user\\auth*test?name"with<greater>and|pipe and spaces')
    ).toBe('feat_add-user_auth_test_name_with_greater_and_pipe_and_spaces');
    expect(() => sanitizeBranchName('')).toThrow('Branch name cannot be empty or blank');
    expect(sanitizeBranchName('   main   ')).toBe('main');
  });

  test('environment variable STAGING_DIR overrides default staging base dir', () => {
    process.env.STAGING_DIR = '/env/custom/staging';
    expect(getStagingBaseDir()).toBe('/env/custom/staging');
  });

  test('environment variable CODE_REVIEW_STAGING_DIR overrides default staging base dir', () => {
    delete process.env.STAGING_DIR;
    process.env.CODE_REVIEW_STAGING_DIR = '/env/code_review_staging';
    expect(getStagingBaseDir()).toBe('/env/code_review_staging');
  });

  test('getPromptFilePath resolves existing code-review-prompt.md in src/prompts/', () => {
    const promptPath = getPromptFilePath();
    expect(promptPath).toBeTruthy();
    expect(promptPath.endsWith('src/prompts/code-review-prompt.md')).toBe(true);
  });

  test('getPromptFilePath prefers process.resourcesPath if prompt file exists there', () => {
    const origResourcesPath = process.resourcesPath;
    try {
      (process as { resourcesPath?: string }).resourcesPath = process.cwd();
      const promptPath = getPromptFilePath();
      expect(promptPath).toBe(path.join(process.cwd(), 'src', 'prompts', 'code-review-prompt.md'));
    } finally {
      (process as { resourcesPath?: string }).resourcesPath = origResourcesPath;
    }
  });

  test('getDiffPromptFilePath resolves existing code-review-diff-prompt.md in src/prompts/', () => {
    const diffPromptPath = getDiffPromptFilePath();
    expect(diffPromptPath).toBeTruthy();
    expect(diffPromptPath.endsWith('src/prompts/code-review-diff-prompt.md')).toBe(true);
  });
});
