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

import { InstallService } from '../src/main/services/installService';

describe('InstallService', () => {
  let dummyDir: string;
  let installService: InstallService;

  beforeEach(() => {
    installService = new InstallService();
    dummyDir = path.join(
      os.tmpdir(),
      `jest_install_${Date.now()}_${Math.random().toString(36).substring(7)}`
    );
    fs.mkdirSync(dummyDir, { recursive: true });
    mockExec.mockReset();
  });

  afterEach(() => {
    if (fs.existsSync(dummyDir)) {
      fs.rmSync(dummyDir, { recursive: true, force: true });
    }
  });

  test('skips npm install when package.json is absent', async () => {
    const res = await installService.installDependencies(dummyDir);
    expect(res.success).toBe(true);
    expect(res.installed).toBe(false);
  });

  test('runs npm ci when package.json exists and succeeds', async () => {
    fs.writeFileSync(path.join(dummyDir, 'package.json'), '{}');
    const logs: string[] = [];

    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      callback(null, 'added 100 packages', 'npm warn deprecated');
    });

    const res = await installService.installDependencies(dummyDir, (l) => logs.push(l.message));
    expect(res.success).toBe(true);
    expect(res.installed).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
  });

  test('returns success false if npm install fails', async () => {
    fs.writeFileSync(path.join(dummyDir, 'package.json'), '{}');

    mockExec.mockImplementation((cmd: string, opts: unknown, cb?: ExecCallback) => {
      const callback = typeof opts === 'function' ? (opts as ExecCallback) : (cb as ExecCallback);
      callback(new Error('Network error'), '', 'Network error');
    });

    const res = await installService.installDependencies(dummyDir);
    expect(res.success).toBe(false);
    expect(res.error).toBeTruthy();
  });
});
