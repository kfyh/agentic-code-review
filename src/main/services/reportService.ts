import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { injectable, inject } from 'tsyringe';
import { ReviewReport } from '../../shared/types';
import { getStagedDir, getStagingBaseDir } from '../config';
import { StdoutReportParser } from './stdoutReportParser';

const IGNORED_MARKDOWN_FILES = new Set([
  'readme.md',
  'tasklist.md',
  'changelog.md',
  'contributing.md',
  'claude.md',
]);

@injectable()
export class ReportService {
  constructor(
    @inject(StdoutReportParser) private parser: StdoutReportParser = new StdoutReportParser()
  ) {}

  /**
   * Scans and loads generated markdown reports from `<stagedDir>/reports/`, `<stagedDir>/output/`,
   * `<stagedDir>/compare/reports/`, `<stagedDir>/base/reports/`, or root-level report files in `<stagedDir>/`.
   * Supports branch names/keys, standard commit SHAs, and `diff-<branchKey>` staging directories.
   */
  public async getReports(branchOrKey: string): Promise<ReviewReport[]> {
    if (!branchOrKey || !branchOrKey.trim()) {
      return [];
    }

    const cleanId = branchOrKey.trim();
    const candidateDirs: string[] = [];

    // 1. Direct staging dir lookup using sanitized key
    candidateDirs.push(getStagedDir(cleanId));

    // 2. Check with/without diff- prefix
    if (!cleanId.startsWith('diff-')) {
      candidateDirs.push(getStagedDir(`diff-${cleanId}`));
    } else {
      candidateDirs.push(getStagedDir(cleanId.replace(/^diff-/, '')));
    }

    // 3. Direct path without sanitization (if distinct)
    const directPath = path.join(getStagingBaseDir(), cleanId);
    if (!candidateDirs.includes(directPath)) {
      candidateDirs.push(directPath);
    }

    // 4. Absolute path support
    if (path.isAbsolute(cleanId) && !candidateDirs.includes(cleanId)) {
      candidateDirs.push(cleanId);
    }

    // 5. Fallback: scan staging directories for matching context.json (e.g. if SHA was provided)
    const stagingBase = getStagingBaseDir();
    if (fs.existsSync(stagingBase)) {
      try {
        const entries = fs.readdirSync(stagingBase, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dirPath = path.join(stagingBase, entry.name);
            if (!candidateDirs.includes(dirPath)) {
              const contextFile = path.join(dirPath, 'context.json');
              if (fs.existsSync(contextFile)) {
                try {
                  const ctx = JSON.parse(fs.readFileSync(contextFile, 'utf-8'));
                  if (
                    ctx.commitSha === cleanId ||
                    ctx.compareCommitSha === cleanId ||
                    ctx.baseCommitSha === cleanId ||
                    ctx.branch === cleanId ||
                    ctx.compareBranch === cleanId ||
                    ctx.baseBranch === cleanId
                  ) {
                    candidateDirs.push(dirPath);
                  }
                } catch {
                  // ignore invalid json
                }
              }
            }
          }
        }
      } catch {
        // ignore directory read error
      }
    }

    const reports: ReviewReport[] = [];
    const processedPaths = new Set<string>();

    const addReportFromFile = (filePath: string) => {
      if (processedPaths.has(filePath) || !fs.existsSync(filePath)) return;
      try {
        const fileName = path.basename(filePath);
        if (IGNORED_MARKDOWN_FILES.has(fileName.toLowerCase())) return;

        const content = fs.readFileSync(filePath, 'utf-8');
        if (!content || content.trim().length === 0) return;

        const packageName = fileName.replace(/\.md$/i, '');
        reports.push({
          packageName,
          filePath,
          content,
        });
        processedPaths.add(filePath);
      } catch (err) {
        console.error(`Failed to read report file ${filePath}:`, err);
      }
    };

    try {
      for (const stagedDir of candidateDirs) {
        if (!fs.existsSync(stagedDir)) continue;

        this.scanDirectoryForReports(path.join(stagedDir, 'reports'), addReportFromFile);
        this.scanDirectoryForReports(path.join(stagedDir, 'output'), addReportFromFile);
        this.scanDirectoryForReports(path.join(stagedDir, 'compare', 'reports'), addReportFromFile);
        this.scanDirectoryForReports(path.join(stagedDir, 'base', 'reports'), addReportFromFile);
        this.scanRootFilesForReports(stagedDir, addReportFromFile);
      }

      if (reports.length === 0) {
        this.scanFallbackDirectories(addReportFromFile);
      }

      return reports;
    } catch (err) {
      console.error(`Failed to read reports for ${branchOrKey}:`, err);
      return [];
    }
  }

  /**
   * Fallback extraction: Parses streamed stdout lines to recover markdown review report
   * if the container agent wrote to an unmounted path or failed to save to disk.
   * Targets `reports/review.md` for both review flows.
   */
  public extractReportFromStdout(
    stdoutLines: string[],
    stagedDir: string,
    onLog?: (msg: string) => void,
    reportFileName: string = 'review.md'
  ): boolean {
    const reportsDir = path.join(stagedDir, 'reports');
    if (this.hasNonEmptyReports(reportsDir)) {
      return true;
    }

    const reportText = this.parser.parseReportText(stdoutLines);
    if (!reportText) {
      return false;
    }

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const targetPath = path.join(reportsDir, reportFileName);
    fs.writeFileSync(targetPath, reportText, 'utf-8');
    if (onLog) {
      onLog(
        `[AGENT STDOUT FALLBACK] Extracted report from stdout stream and saved to ${targetPath}`
      );
    }
    return true;
  }

  private scanDirectoryForReports(dir: string, addReportFn: (filePath: string) => void): void {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    files.forEach((f) => addReportFn(path.join(dir, f)));
  }

  private scanRootFilesForReports(
    stagedDir: string,
    addReportFn: (filePath: string) => void
  ): void {
    if (!fs.existsSync(stagedDir)) return;
    const rootFiles = fs.readdirSync(stagedDir).filter((f) => f.endsWith('.md'));
    for (const file of rootFiles) {
      const lower = file.toLowerCase();
      // Include all markdown files in root except standard ignored repository documents
      if (IGNORED_MARKDOWN_FILES.has(lower)) continue;
      addReportFn(path.join(stagedDir, file));
    }
  }

  private scanFallbackDirectories(addReportFn: (filePath: string) => void): void {
    const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
    const candidateSearchDirs = [
      path.join(os.homedir(), '.local/share/containers/storage/volumes'),
      path.join(os.homedir(), '.gemini/antigravity-cli/brain'),
      path.join(os.homedir(), '.claude'),
    ];

    for (const searchDir of candidateSearchDirs) {
      if (!fs.existsSync(searchDir)) continue;
      try {
        this.findRecentReportsRecursive(searchDir, fifteenMinutesAgo, addReportFn);
      } catch {
        // Ignore permission or traversal errors
      }
    }
  }

  private hasNonEmptyReports(reportsDir: string): boolean {
    if (!fs.existsSync(reportsDir)) return false;
    try {
      const existing = fs.readdirSync(reportsDir).filter((f) => {
        if (!f.endsWith('.md')) return false;
        try {
          const stat = fs.statSync(path.join(reportsDir, f));
          return stat.size > 10;
        } catch {
          return false;
        }
      });
      return existing.length > 0;
    } catch {
      return false;
    }
  }

  private findRecentReportsRecursive(
    dir: string,
    minTime: number,
    addReportFn: (filePath: string) => void,
    depth: number = 0
  ) {
    if (depth > 5 || !fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this.findRecentReportsRecursive(fullPath, minTime, addReportFn, depth + 1);
        } else if (
          entry.isFile() &&
          entry.name.endsWith('.md') &&
          (entry.name.includes('smells') ||
            entry.name.includes('report') ||
            entry.name.includes('code'))
        ) {
          const stat = fs.statSync(fullPath);
          if (stat.mtimeMs >= minTime && stat.size > 10) {
            addReportFn(fullPath);
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }
}
