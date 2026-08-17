import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import {
  getBaseAppDir,
  getUserDataDir,
  getStagingBaseDir,
  setStagingDir,
  getStagedDir,
  getHistoryFilePath,
  getGitCacheDir,
  getWorkspacesDir,
  getPromptFilePath,
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
    expect(getStagedDir('sha123')).toBe(path.join(customDir, 'sha123'));
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

  test('getPromptFilePath returns code-review-prompt.md in process.cwd', () => {
    const promptPath = getPromptFilePath();
    expect(promptPath).toBe(path.join(process.cwd(), 'code-review-prompt.md'));
  });
});
