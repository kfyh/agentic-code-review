import 'reflect-metadata';
import { StdoutReportParser } from '../src/main/services/stdoutReportParser';

describe('StdoutReportParser', () => {
  let parser: StdoutReportParser;

  beforeEach(() => {
    parser = new StdoutReportParser();
  });

  test('findReportStartIndex locates heading start line', () => {
    const lines = [
      'Initializing container...',
      'Running tool AST check...',
      '# Executive Summary',
      'This codebase has 0 circular dependencies.',
    ];
    expect(parser.findReportStartIndex(lines)).toBe(2);
  });

  test('findReportStartIndex returns -1 if no markdown report header is found', () => {
    const lines = ['Log line 1', 'Log line 2', 'Session finished without header'];
    expect(parser.findReportStartIndex(lines)).toBe(-1);
  });

  test('parseReportText extracts report text until session end marker', () => {
    const lines = [
      'Log 1',
      '# Code Smell Report',
      '## Hotspots',
      'Hotspot 1 found',
      '🛠️ [Tool Use: madge]',
      '🏁 Session Finished',
      'After session output',
    ];

    const result = parser.parseReportText(lines);
    expect(result).toBe('# Code Smell Report\n## Hotspots\nHotspot 1 found');
  });

  test('parseReportText returns null if no valid start header exists', () => {
    const lines = ['Just stdout log lines', 'No report created'];
    expect(parser.parseReportText(lines)).toBeNull();
  });
});
