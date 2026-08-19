import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

const mockExec = jest.fn();
jest.mock('node:child_process', () => {
  const customSymbol = Symbol.for('nodejs.util.promisify.custom');
  const fn = (...args: unknown[]) => mockExec(...args);
  (fn as unknown as Record<symbol, unknown>)[customSymbol] = (...args: unknown[]) =>
    new Promise((resolve, reject) => {
      mockExec(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });
  return { exec: fn };
});

import { GitService } from '../src/main/services/gitService';
import { setStagingDir } from '../src/main/config';

describe('GitService', () => {
  let gitService: GitService;
  let customStagingBase: string;

  beforeEach(() => {
    gitService = new GitService();
    customStagingBase = path.join(
      os.tmpdir(),
      `jest_git_test_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    setStagingDir(customStagingBase);
    mockExec.mockReset();
  });

  afterEach(() => {
    setStagingDir(null);
    if (fs.existsSync(customStagingBase)) {
      fs.rmSync(customStagingBase, { recursive: true, force: true });
    }
  });

  test('returns fallback branch "main" when empty URL provided', async () => {
    const res = await gitService.detectRemoteDefaultBranch('   ');
    expect(res.branch).toBe('main');
    expect(res.isFallback).toBe(true);
  });

  test('parses default branch from stdout when git ls-remote succeeds', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      callback(
        null,
        'ref: refs/heads/feature-branch\tHEAD\n84923bd151f6d5d77dd19392667a1c34f476ebaa\tHEAD',
        ''
      );
    });

    const res = await gitService.detectRemoteDefaultBranch('git@github.com:org/repo.git');
    expect(res.branch).toBe('feature-branch');
    expect(res.isFallback).toBe(false);
  });

  test('parses remote branch list from git ls-remote --heads', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      callback(
        null,
        'sha1\trefs/heads/feature/JIRA-1\nsha2\trefs/heads/main\nsha3\trefs/heads/develop\n',
        ''
      );
    });

    const res = await gitService.getRemoteBranches('git@github.com:org/repo.git');
    expect(res.success).toBe(true);
    expect(res.branches).toEqual(['main', 'develop', 'feature/JIRA-1']);
  });

  test('prepares git workspace by cloning, checking out branch, and resolving SHA', async () => {
    const logs: string[] = [];
    const validSha = '84923bd151f6d5d77dd19392667a1c34f476ebaa';

    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      if (cmd.includes('rev-parse HEAD')) {
        callback(null, `${validSha}\n`, '');
      } else {
        callback(null, 'ok', '');
      }
    });

    const { commitSha, workspaceDir } = await gitService.prepareGitWorkspace(
      'git@github.com:org/repo.git',
      'main',
      (l) => logs.push(l.message)
    );

    expect(commitSha).toBe(validSha);
    expect(workspaceDir).toBeTruthy();
    expect(logs.length).toBeGreaterThan(0);
  });

  test('handles checkout fallback and pull notice when checkout or pull fails', async () => {
    const logs: string[] = [];
    const validSha = '84923bd151f6d5d77dd19392667a1c34f476ebaa';

    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      if (cmd.includes('checkout') && !cmd.includes('origin')) {
        callback(new Error('pathspec main did not match any file(s)'), '', 'error');
      } else if (cmd.includes('pull origin')) {
        callback(new Error('Already up to date'), '', 'notice');
      } else if (cmd.includes('rev-parse HEAD')) {
        callback(null, `${validSha}\n`, '');
      } else {
        callback(null, 'ok', '');
      }
    });

    const { commitSha } = await gitService.prepareGitWorkspace(
      'git@github.com:org/repo.git',
      'main',
      (l) => logs.push(l.message)
    );

    expect(commitSha).toBe(validSha);
    expect(logs.some((l) => l.includes('Fetching and checking out origin/main'))).toBe(true);
    expect(logs.some((l) => l.includes('Pull notice'))).toBe(true);
  });

  test('throws error when commit SHA is invalid or truncated', async () => {
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      if (cmd.includes('rev-parse HEAD')) {
        callback(null, 'shortsha', '');
      } else {
        callback(null, 'ok', '');
      }
    });

    await expect(
      gitService.prepareGitWorkspace('git@github.com:org/repo.git', 'main')
    ).rejects.toThrow('Failed to resolve valid full commit SHA');
  });

  test('logs warning when SSH permission error occurs', async () => {
    const logs: string[] = [];
    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      callback(new Error('Permission denied (publickey)'), '', 'Permission denied (publickey).');
    });

    await expect(
      gitService.prepareGitWorkspace('git@github.com:org/repo.git', 'main', (l) =>
        logs.push(l.message)
      )
    ).rejects.toThrow();

    expect(logs.some((l) => l.includes('SSH Authentication failed'))).toBe(true);
  });
});
