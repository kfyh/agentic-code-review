import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AgentInvoker } from '../src/main/services/agentInvoker';
import * as config from '../src/main/config';
import { EventEmitter } from 'node:events';

jest.mock('node:child_process');

describe('AgentInvoker', () => {
  let invoker: AgentInvoker;
  let testStagedDir: string;
  let dummyPromptPath: string;

  beforeEach(() => {
    invoker = new AgentInvoker();
    testStagedDir = path.join(
      os.tmpdir(),
      `jest_agent_staged_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    fs.mkdirSync(testStagedDir, { recursive: true });

    dummyPromptPath = path.join(
      os.tmpdir(),
      `jest_prompt_${Date.now()}_${Math.random().toString(36).substring(7)}.md`
    );
    fs.writeFileSync(dummyPromptPath, '# Code Review Prompt');
  });

  afterEach(() => {
    if (fs.existsSync(testStagedDir)) {
      fs.rmSync(testStagedDir, { recursive: true, force: true });
    }
    if (fs.existsSync(dummyPromptPath)) {
      fs.rmSync(dummyPromptPath, { force: true });
    }
    jest.restoreAllMocks();
  });

  test('returns error when prompt file does not exist', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue('/non/existent/prompt.md');
    const res = await invoker.runAgent(testStagedDir);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Prompt file not found');
  });

  test('returns error when prompt file cannot be read', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const res = await invoker.runAgent(testStagedDir);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Failed to read prompt file');
  });

  test('runs agent process successfully and streams stdout/stderr', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);

    const mockChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = jest.fn();

    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const logs: string[] = [];
    const promise = invoker.runAgent(testStagedDir, (entry) => logs.push(entry.message));

    // Emit stdout and stderr data
    mockChild.stdout.emit('data', Buffer.from('# Code Smell Deliverable\nSome finding\n'));
    mockChild.stderr.emit('data', Buffer.from('run-agent: not found\n'));
    mockChild.emit('close', 0, null);

    const res = await promise;
    expect(res.success).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  test('handles non-zero process exit code', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);

    const mockChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = jest.fn();

    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const logs: string[] = [];
    const promise = invoker.runAgent(testStagedDir, (entry) => logs.push(entry.message));

    mockChild.emit('close', 1, null);

    const res = await promise;
    expect(res.success).toBe(false);
    expect(logs.some((l) => l.includes('exit code 1'))).toBe(true);
  });

  test('handles process spawn error event', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);

    const mockChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = invoker.runAgent(testStagedDir);
    mockChild.emit('error', new Error('Spawn failed'));

    const res = await promise;
    expect(res.success).toBe(false);
    expect(res.error).toBe('Spawn failed');
  });

  test('aborts execution when abortExecution is called', async () => {
    jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);

    const mockChild = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: jest.Mock;
    };
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();
    mockChild.kill = jest.fn(() => {
      mockChild.emit('close', null, 'SIGTERM');
    });

    (spawn as unknown as jest.Mock).mockReturnValue(mockChild);

    const promise = invoker.runAgent(testStagedDir);
    const aborted = invoker.abortExecution();
    expect(aborted).toBe(true);

    const res = await promise;
    expect(res.aborted).toBe(true);
  });

  test('abortExecution returns false if no active process', () => {
    expect(invoker.abortExecution()).toBe(false);
  });

  describe('login shell resolution', () => {
    const originalAgentShell = process.env.AGENT_SHELL;
    const originalShell = process.env.SHELL;

    const mockSpawnedChild = () => {
      const mockChild = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: jest.Mock;
      };
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.kill = jest.fn();
      (spawn as unknown as jest.Mock).mockReturnValue(mockChild);
      return mockChild;
    };

    /** Resolves runAgent by immediately closing the mocked child. */
    const invokeAndGetShell = async (mockChild: EventEmitter) => {
      const promise = invoker.runAgent(testStagedDir);
      mockChild.emit('close', 0, null);
      await promise;
      return (spawn as unknown as jest.Mock).mock.calls[0][0];
    };

    beforeEach(() => {
      jest.spyOn(config, 'getPromptFilePath').mockReturnValue(dummyPromptPath);
      (spawn as unknown as jest.Mock).mockClear();
      delete process.env.AGENT_SHELL;
    });

    afterEach(() => {
      if (originalAgentShell === undefined) {
        delete process.env.AGENT_SHELL;
      } else {
        process.env.AGENT_SHELL = originalAgentShell;
      }
      if (originalShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = originalShell;
      }
    });

    test('prefers AGENT_SHELL override over all other sources', async () => {
      process.env.AGENT_SHELL = '/opt/custom/fish';
      jest.spyOn(os, 'userInfo').mockReturnValue({ shell: '/bin/zsh' } as os.UserInfo<string>);

      expect(await invokeAndGetShell(mockSpawnedChild())).toBe('/opt/custom/fish');
    });

    test('uses the passwd record shell when no override is set', async () => {
      process.env.SHELL = '/bin/bash';
      jest.spyOn(os, 'userInfo').mockReturnValue({ shell: '/bin/zsh' } as os.UserInfo<string>);

      expect(await invokeAndGetShell(mockSpawnedChild())).toBe('/bin/zsh');
    });

    test('falls back to process.env.SHELL when there is no passwd entry', async () => {
      process.env.SHELL = '/usr/bin/fish';
      jest.spyOn(os, 'userInfo').mockImplementation(() => {
        throw new Error('no passwd entry');
      });

      expect(await invokeAndGetShell(mockSpawnedChild())).toBe('/usr/bin/fish');
    });

    test('falls back to the platform default when passwd and SHELL are both absent', async () => {
      delete process.env.SHELL;
      jest.spyOn(os, 'userInfo').mockReturnValue({ shell: '' } as os.UserInfo<string>);

      const expected = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
      expect(await invokeAndGetShell(mockSpawnedChild())).toBe(expected);
    });

    test('spawns the shell with -i so the rc file is sourced', async () => {
      jest.spyOn(os, 'userInfo').mockReturnValue({ shell: '/bin/zsh' } as os.UserInfo<string>);

      const mockChild = mockSpawnedChild();
      await invokeAndGetShell(mockChild);

      const [, args] = (spawn as unknown as jest.Mock).mock.calls[0];
      expect(args[0]).toBe('-i');
      expect(args[1]).toBe('-c');
      expect(args[2]).toContain('run-agent . -p ');
    });

    test('names the shell and its rc file when the alias is missing', async () => {
      jest.spyOn(os, 'userInfo').mockReturnValue({ shell: '/bin/zsh' } as os.UserInfo<string>);

      const mockChild = mockSpawnedChild();
      const logs: string[] = [];
      const promise = invoker.runAgent(testStagedDir, (entry) => logs.push(entry.message));

      mockChild.stderr.emit('data', Buffer.from('zsh: command not found: run-agent\n'));
      mockChild.emit('close', 127, null);
      await promise;

      const warning = logs.find((l) => l.includes('[AGENT WARNING]'));
      expect(warning).toContain('/bin/zsh');
      expect(warning).toContain('~/.zshrc');
    });
  });
});
