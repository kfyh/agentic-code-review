import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewReport } from '../../shared/types';
import { getStagedDir } from '../config';

const IGNORED_MARKDOWN_FILES = new Set([
  'readme.md',
  'tasklist.md',
  'changelog.md',
  'contributing.md',
  'claude.md',
]);

export class ReportService {
  /**
   * Scans and loads generated markdown reports from `<stagedDir>/reports/`, `<stagedDir>/output/`,
   * or root-level report files in `<stagedDir>/`.
   */
  public async getReports(commitSha: string): Promise<ReviewReport[]> {
    const stagedDir = getStagedDir(commitSha);

    if (!fs.existsSync(stagedDir)) {
      return [];
    }

    const reports: ReviewReport[] = [];
    const processedPaths = new Set<string>();

    const addReportFromFile = (filePath: string) => {
      if (processedPaths.has(filePath) || !fs.existsSync(filePath)) return;
      try {
        const fileName = path.basename(filePath);
        if (IGNORED_MARKDOWN_FILES.has(fileName.toLowerCase())) return;

        const content = fs.readFileSync(filePath, 'utf-8');
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
      // 1. Primary: Scan <stagedDir>/reports/*.md
      const reportsDir = path.join(stagedDir, 'reports');
      if (fs.existsSync(reportsDir)) {
        const files = fs.readdirSync(reportsDir).filter((f) => f.endsWith('.md'));
        files.forEach((f) => addReportFromFile(path.join(reportsDir, f)));
      }

      // 2. Secondary: Scan <stagedDir>/output/*.md
      const outputDir = path.join(stagedDir, 'output');
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md'));
        files.forEach((f) => addReportFromFile(path.join(outputDir, f)));
      }

      // 3. Fallback: Scan root <stagedDir>/*.md for code smell / report files
      const rootFiles = fs.readdirSync(stagedDir).filter((f) => f.endsWith('.md'));
      for (const file of rootFiles) {
        const lower = file.toLowerCase();
        if (lower.includes('code_smells') || lower.includes('report') || lower.includes('smells')) {
          addReportFromFile(path.join(stagedDir, file));
        }
      }

      // 4. Fallback: If no reports found on disk, search Podman rootless volumes & home brain directories
      if (reports.length === 0) {
        const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
        const candidateSearchDirs = [
          path.join(os.homedir(), '.local/share/containers/storage/volumes'),
          path.join(os.homedir(), '.gemini/antigravity-cli/brain'),
          path.join(os.homedir(), '.claude'),
        ];

        for (const searchDir of candidateSearchDirs) {
          if (!fs.existsSync(searchDir)) continue;
          try {
            this.findRecentReportsRecursive(searchDir, fifteenMinutesAgo, addReportFromFile);
            if (reports.length > 0) break;
          } catch {
            // Ignore permission or traversal errors
          }
        }
      }

      return reports;
    } catch (err) {
      console.error(`Failed to read reports from ${stagedDir}:`, err);
      return [];
    }
  }

  /**
   * Fallback extraction: Parses streamed stdout lines to recover markdown review report
   * if the container agent wrote to an unmounted path or failed to save to disk.
   */
  public extractReportFromStdout(
    stdoutLines: string[],
    stagedDir: string,
    onLog?: (msg: string) => void
  ): boolean {
    const reportsDir = path.join(stagedDir, 'reports');
    if (fs.existsSync(reportsDir)) {
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
        if (existing.length > 0) {
          return true;
        }
      } catch {
        // Ignore directory read errors
      }
    }

    let startIndex = -1;
    for (let i = 0; i < stdoutLines.length; i++) {
      const line = stdoutLines[i].trim();
      if (
        line.startsWith('# Code Smell') ||
        line.startsWith('# Code Review') ||
        line.startsWith('# Deliverables') ||
        line.startsWith('# Executive Summary') ||
        line.startsWith('# 1. Executive Summary') ||
        line.startsWith('# ')
      ) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) {
      return false;
    }

    const reportLines: string[] = [];
    for (let i = startIndex; i < stdoutLines.length; i++) {
      const line = stdoutLines[i];
      if (
        line.includes('🏁 Session Finished') ||
        line.includes('📊 Usage:') ||
        line.includes('❌ Session failed')
      ) {
        break;
      }
      if (!line.includes('🛠️ [Tool Use:')) {
        reportLines.push(line);
      }
    }

    if (reportLines.length === 0) {
      return false;
    }

    const reportText = reportLines.join('\n').trim();
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const targetPath = path.join(reportsDir, 'code_smells.md');
    fs.writeFileSync(targetPath, reportText, 'utf-8');
    if (onLog) {
      onLog(
        `[AGENT STDOUT FALLBACK] Extracted report from stdout stream and saved to ${targetPath}`
      );
    }
    return true;
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

export const reportService = new ReportService();
