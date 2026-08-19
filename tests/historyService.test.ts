import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HistoryService } from '../src/main/services/historyService';

describe('HistoryService', () => {
  let testHistoryPath: string;
  let historyService: HistoryService;

  beforeEach(() => {
    testHistoryPath = path.join(
      os.tmpdir(),
      `jest_history_${Date.now()}_${Math.random().toString(36).substring(7)}.json`
    );
    historyService = new HistoryService(testHistoryPath);
  });

  afterEach(() => {
    if (fs.existsSync(testHistoryPath)) {
      fs.rmSync(testHistoryPath, { force: true });
    }
    jest.restoreAllMocks();
  });

  test('returns empty array when history file does not exist', () => {
    expect(historyService.getHistory()).toEqual([]);
  });

  test('returns empty array when default constructor is called', () => {
    const defaultSvc = new HistoryService();
    expect(Array.isArray(defaultSvc.getHistory())).toBe(true);
  });

  test('returns empty array when JSON is not an array', () => {
    fs.writeFileSync(testHistoryPath, '{"key": "value"}');
    expect(historyService.getHistory()).toEqual([]);
  });

  test('returns empty array when reading file fails', () => {
    fs.writeFileSync(testHistoryPath, 'invalid json {{{');
    expect(historyService.getHistory()).toEqual([]);
  });

  test('handles directory creation and write errors gracefully', () => {
    const nestedPath = path.join(os.tmpdir(), `nested_${Date.now()}`, 'history.json');
    const nestedSvc = new HistoryService(nestedPath);

    const res = nestedSvc.addOrUpdateHistory({
      gitUrl: 'git@github.com:acme/backend.git',
      lastBranch: 'dev',
    });
    expect(res.length).toBe(1);

    if (fs.existsSync(nestedPath)) {
      fs.rmSync(path.dirname(nestedPath), { recursive: true, force: true });
    }
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
