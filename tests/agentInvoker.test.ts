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
});
