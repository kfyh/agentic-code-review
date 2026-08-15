import React from 'react';
import { ReviewStage } from '../../shared/types';
import { CheckCircle2, Circle, AlertTriangle, XCircle, Loader2, FileText } from 'lucide-react';

interface StatusTimelineProps {
  stage: ReviewStage;
  commitSha?: string;
  error?: string;
  hasReport?: boolean;
  onOpenReport?: () => void;
}

export const StatusTimeline: React.FC<StatusTimelineProps> = ({ stage, commitSha, error, hasReport, onOpenReport }) => {
  const stages: { key: ReviewStage; label: string }[] = [
    { key: 'fetching', label: 'Fetching Branch' },
    { key: 'staging', label: 'Staging Prep' },
    { key: 'running', label: 'Running Agent' },
    { key: 'completed', label: 'Review Complete' },
  ];

  const getStageIndex = (currentStage: ReviewStage): number => {
    switch (currentStage) {
      case 'fetching': return 0;
      case 'installing': return 0;
      case 'staging': return 1;
      case 'running': return 2;
      case 'completed': return 3;
      case 'failed':
      case 'aborted': return 3;
      default: return -1;
    }
  };

  const currentIndex = getStageIndex(stage);

  return (
    <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          Execution Pipeline Stage
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {(stage === 'completed' || hasReport) && onOpenReport && (
            <button
              className="btn-primary"
              style={{ height: '30px', padding: '0 0.85rem', fontSize: '0.78rem' }}
              onClick={onOpenReport}
            >
              <FileText size={14} />
              <span>View Review Report</span>
            </button>
          )}

          {commitSha && (
            <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
              SHA: {commitSha.substring(0, 8)}...
            </div>
          )}
        </div>
      </div>

      <div className="timeline-container">
        {stages.map((s, idx) => {
          const isCompleted = currentIndex > idx || stage === 'completed';
          const isActive = currentIndex === idx && stage !== 'completed' && stage !== 'failed' && stage !== 'aborted';
          const isFailed = (stage === 'failed' || stage === 'aborted') && currentIndex === idx;

          return (
            <React.Fragment key={s.key}>
              <div className="timeline-step">
                <div
                  className={`step-circle ${isCompleted ? 'completed' : isActive ? 'active' : isFailed ? 'failed' : ''}`}
                >
                  {isCompleted ? (
                    <CheckCircle2 size={18} />
                  ) : isActive ? (
                    <Loader2 size={18} className="spin" />
                  ) : isFailed ? (
                    <XCircle size={18} />
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className={`step-label ${isActive || isCompleted ? 'active' : ''}`}>
                  {s.label}
                </span>
              </div>

              {idx < stages.length - 1 && (
                <div className={`timeline-connector ${isCompleted ? 'completed' : ''}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {error && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.6rem 0.85rem',
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '6px',
            fontSize: '0.8rem',
            color: 'var(--status-error)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
