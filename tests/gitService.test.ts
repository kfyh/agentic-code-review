import { gitService } from '../src/main/services/gitService';

describe('GitService', () => {
  test('returns fallback branch "main" when git ls-remote fails or URL is invalid', async () => {
    const res = await gitService.detectRemoteDefaultBranch('invalid-url-12345');
    expect(res.branch).toBe('main');
    expect(res.isFallback).toBe(true);
  });

  test('returns fallback branch "main" when empty URL provided', async () => {
    const res = await gitService.detectRemoteDefaultBranch('   ');
    expect(res.branch).toBe('main');
    expect(res.isFallback).toBe(true);
  });
});
