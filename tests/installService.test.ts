import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installService } from '../src/main/services/installService';

describe('InstallService', () => {
  let dummyDir: string;

  beforeEach(() => {
    dummyDir = path.join(os.tmpdir(), `jest_install_${Date.now()}_${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(dummyDir, { recursive: true });
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
});
