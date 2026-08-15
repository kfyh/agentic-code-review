import fs from 'node:fs';
import path from 'node:path';
import { HistoryEntry } from '../../shared/types';
import { getHistoryFilePath } from '../config';

const MAX_HISTORY_CAPACITY = 30;

export class HistoryService {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || getHistoryFilePath();
  }

  /**
   * Retrieves stored history sorted reverse-chronologically by lastReviewedAt.
   */
  public getHistory(): HistoryEntry[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const rawData = fs.readFileSync(this.filePath, 'utf-8');
      const entries: HistoryEntry[] = JSON.parse(rawData);
      if (!Array.isArray(entries)) {
        return [];
      }
      return entries.sort(
        (a, b) => new Date(b.lastReviewedAt).getTime() - new Date(a.lastReviewedAt).getTime()
      );
    } catch (err) {
      console.error('Failed to read repo history:', err);
      return [];
    }
  }

  /**
   * Adds or updates a repository entry in history.
   * Keyed by unique gitUrl. Keeps max 30 entries, reverse-chronological.
   */
  public addOrUpdateHistory(entry: Omit<HistoryEntry, 'lastReviewedAt'> & { lastReviewedAt?: string }): HistoryEntry[] {
    const current = this.getHistory();
    const now = entry.lastReviewedAt || new Date().toISOString();
    
    // Remove any existing entry for this gitUrl (case-insensitive check)
    const filtered = current.filter(
      (item) => item.gitUrl.trim().toLowerCase() !== entry.gitUrl.trim().toLowerCase()
    );

    const updatedEntry: HistoryEntry = {
      gitUrl: entry.gitUrl.trim(),
      lastBranch: entry.lastBranch.trim(),
      lastCommitSha: entry.lastCommitSha ? entry.lastCommitSha.trim() : undefined,
      lastReviewedAt: now,
    };

    const newHistory = [updatedEntry, ...filtered].slice(0, MAX_HISTORY_CAPACITY);

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(newHistory, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write repo history:', err);
    }

    return newHistory;
  }
}

export const historyService = new HistoryService();
