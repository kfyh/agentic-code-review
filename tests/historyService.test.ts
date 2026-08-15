import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HistoryService } from '../src/main/services/historyService';

describe('HistoryService', () => {
  let testHistoryPath: string;
  let historyService: HistoryService;

  beforeEach(() => {
    testHistoryPath = path.join(os.tmpdir(), `jest_history_${Date.now()}_${Math.random().toString(36).substring(7)}.json`);
    historyService = new HistoryService(testHistoryPath);
  });

  afterEach(() => {
    if (fs.existsSync(testHistoryPath)) {
      fs.rmSync(testHistoryPath, { force: true });
    }
  });

  test('returns empty array when history file does not exist', () => {
    expect(historyService.getHistory()).toEqual([]);
  });

  test('adds and stores history entries reverse-chronologically', () => {
    const olderTime = new Date(Date.now() - 10000).toISOString();
    const newerTime = new Date().toISOString();

    historyService.addOrUpdateHistory({
      gitUrl: 'git@github.com:acme/backend.git',
      lastBranch: 'dev',
      lastReviewedAt: olderTime,
    });

    historyService.addOrUpdateHistory({
      gitUrl: 'git@github.com:org/frontend.git',
      lastBranch: 'main',
      lastReviewedAt: newerTime,
    });

    const history = historyService.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].gitUrl).toBe('git@github.com:org/frontend.git');
    expect(history[1].gitUrl).toBe('git@github.com:acme/backend.git');
  });

  test('updating existing repository entry updates branch and moves it to front', () => {
    historyService.addOrUpdateHistory({
      gitUrl: 'git@github.com:acme/backend.git',
      lastBranch: 'dev',
    });

    historyService.addOrUpdateHistory({
      gitUrl: 'git@github.com:org/frontend.git',
      lastBranch: 'main',
    });

    historyService.addOrUpdateHistory({
      gitUrl: 'git@github.com:acme/backend.git',
      lastBranch: 'feature-x',
    });

    const history = historyService.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].gitUrl).toBe('git@github.com:acme/backend.git');
    expect(history[0].lastBranch).toBe('feature-x');
  });

  test('caps history capacity at 30 entries', () => {
    for (let i = 0; i < 35; i++) {
      historyService.addOrUpdateHistory({
        gitUrl: `git@github.com:org/repo-${i}.git`,
        lastBranch: 'main',
      });
    }

    const history = historyService.getHistory();
    expect(history.length).toBe(30);
    expect(history[0].gitUrl).toBe('git@github.com:org/repo-34.git');
  });
});
