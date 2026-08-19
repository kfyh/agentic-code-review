import { injectable } from 'tsyringe';

@injectable()
export class StdoutReportParser {
  /**
   * Scans stdout log stream lines to find the start of markdown review report.
   */
  public findReportStartIndex(stdoutLines: string[]): number {
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
        return i;
      }
    }
    return -1;
  }

  /**
   * Extracts clean markdown report text from container stdout log stream.
   */
  public parseReportText(stdoutLines: string[]): string | null {
    const startIndex = this.findReportStartIndex(stdoutLines);
    if (startIndex === -1) {
      return null;
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
      return null;
    }

    return reportLines.join('\n').trim();
  }
}
