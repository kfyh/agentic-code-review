import React, { useEffect, useRef, useState } from 'react';
import { LogEntry, ReviewStage } from '../../shared/types';
import { Terminal, Square, Trash2, ArrowDown } from 'lucide-react';

interface LogConsoleProps {
  logs: LogEntry[];
  stage: ReviewStage;
  onAbort: () => void;
  onClearLogs: () => void;
}

export const LogConsole: React.FC<LogConsoleProps> = ({ logs, stage, onAbort, onClearLogs }) => {
  const [filterSource, setFilterSource] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logStreamRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((log) => {
    if (filterSource === 'all') return true;
    return log.source === filterSource;
  });

  useEffect(() => {
    if (autoScroll && logStreamRef.current) {
      logStreamRef.current.scrollTop = logStreamRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toTimeString().split(' ')[0];
    } catch {
      return '';
    }
  };

  const isRunning = stage === 'fetching' || stage === 'staging' || stage === 'running';

  return (
    <div className="log-console-panel">
      <div className="console-header">
        <div className="console-title">
          <Terminal size={16} style={{ color: 'var(--accent-cyan)' }} />
          <span>Log Console Output</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            ({filteredLogs.length} entries)
          </span>
        </div>

        <div className="console-actions">
          {/* Source Filters */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              background: 'rgba(0,0,0,0.3)',
              padding: '2px',
              borderRadius: '6px',
            }}
          >
            {['all', 'git', 'staging', 'agent', 'stderr'].map((src) => (
              <button
                key={src}
                onClick={() => setFilterSource(src)}
                style={{
                  background: filterSource === src ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                  color: filterSource === src ? 'var(--accent-cyan)' : 'var(--text-dim)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '0.75rem',
                  fontWeight: filterSource === src ? 600 : 400,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {src}
              </button>
            ))}
          </div>

          {/* Auto Scroll Toggle */}
          <button
            title="Toggle Auto Scroll"
            onClick={() => setAutoScroll(!autoScroll)}
            style={{
              background: autoScroll ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
              color: autoScroll ? 'var(--accent-cyan)' : 'var(--text-dim)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            <ArrowDown size={14} />
          </button>

          {/* Clear Log Button */}
          <button
            title="Clear Console"
            onClick={onClearLogs}
            style={{
              background: 'transparent',
              color: 'var(--text-dim)',
              border: 'none',
              borderRadius: '4px',
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            <Trash2 size={14} />
          </button>

          {/* Abort Execution Button */}
          {isRunning && (
            <button className="btn-abort" onClick={onAbort}>
              <Square size={12} fill="currentColor" />
              <span>Abort</span>
            </button>
          )}
        </div>
      </div>

      <div className="log-stream" ref={logStreamRef}>
        {filteredLogs.length === 0 ? (
          <div
            style={{
              color: 'var(--text-dim)',
              fontStyle: 'italic',
              textAlign: 'center',
              padding: '2rem',
            }}
          >
            No log entries yet. Ready to start code review execution.
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div key={index} className="log-line">
              <span className="log-time">[{formatTimestamp(log.timestamp)}]</span>
              <span className={`log-tag ${log.source}`}>{log.source}</span>
              <span className="log-msg">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
