import React, { useEffect, useState } from 'react';
import { HistoryEntry, LogEntry, ReviewReport, ReviewStage, ReviewStateUpdate } from '../shared/types';
import { LogConsole } from './components/LogConsole';
import { RepoInputForm } from './components/RepoInputForm';
import { ReportViewer } from './components/ReportViewer';
import { StatusTimeline } from './components/StatusTimeline';
import { ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  const [gitUrl, setGitUrl] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [stage, setStage] = useState<ReviewStage>('idle');
  const [commitSha, setCommitSha] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);
  
  const [isDetectingBranch, setIsDetectingBranch] = useState<boolean>(false);
  const [detectedBranchInfo, setDetectedBranchInfo] = useState<{ isFallback?: boolean; error?: string } | null>(null);

  // Load initial repo history
  useEffect(() => {
    const loadHistory = async () => {
      try {
        if (window.api && window.api.getHistory) {
          const items = await window.api.getHistory();
          setHistory(items);
          if (items.length > 0 && !gitUrl) {
            setGitUrl(items[0].gitUrl);
            setBranch(items[0].lastBranch);
          }
        }
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    };
    loadHistory();
  }, []);

  // Subscribe to IPC state updates and log entries
  useEffect(() => {
    if (!window.api) return;

    const unsubscribeState = window.api.onStateUpdate((update: ReviewStateUpdate) => {
      setStage(update.stage);
      if (update.branch) setBranch(update.branch);
      if (update.commitSha) setCommitSha(update.commitSha);
      if (update.error) setError(update.error);

      if (update.stage === 'completed' && update.commitSha) {
        window.api.getReports(update.commitSha).then((res) => {
          setReports(res);
          setShowReportModal(true);
        });
        // Refresh history list
        window.api.getHistory().then(setHistory);
      }
    });

    const unsubscribeLog = window.api.onLogEntry((log: LogEntry) => {
      setLogs((prev) => [...prev, log]);
    });

    return () => {
      unsubscribeState();
      unsubscribeLog();
    };
  }, []);

  // Handle URL blur / history selection to detect remote default branch
  const handleUrlBlurOrSelect = async (url: string) => {
    if (!url || !url.trim() || !window.api) return;
    setIsDetectingBranch(true);
    setDetectedBranchInfo(null);

    try {
      const res = await window.api.detectBranch(url.trim());
      setIsDetectingBranch(false);

      if (res.success && res.branch) {
        setBranch(res.branch);
        setDetectedBranchInfo({ isFallback: res.isFallback });
      } else {
        setDetectedBranchInfo({ isFallback: true, error: res.error });
      }
    } catch (err: any) {
      setIsDetectingBranch(false);
      setDetectedBranchInfo({ isFallback: true, error: err?.message || 'Branch detection query failed' });
    }
  };

  // Start review trigger
  const handleStartReview = async () => {
    if (!gitUrl.trim() || !branch.trim() || !window.api) return;

    setError(undefined);
    setReports([]);
    setLogs([]);
    setShowReportModal(false);
    setStage('fetching');

    const res = await window.api.startReview({
      gitUrl: gitUrl.trim(),
      branch: branch.trim(),
    });

    if (!res.success) {
      setError(res.error || 'Failed to start review process');
    }
  };

  // Abort trigger
  const handleAbortReview = async () => {
    if (window.api) {
      await window.api.abortReview();
    }
  };

  return (
    <div className="app-container">
      {/* App Header */}
      <header className="app-header">
        <div className="app-title-group">
          <div className="app-logo">
            <ShieldCheck />
          </div>
          <div>
            <h1 className="app-title">Code Review App</h1>
            <p className="app-subtitle">Phase 1 Single Repository Automated Review Suite</p>
          </div>
        </div>
      </header>

      {/* Input Form */}
      <RepoInputForm
        gitUrl={gitUrl}
        setGitUrl={setGitUrl}
        branch={branch}
        setBranch={setBranch}
        history={history}
        onStartReview={handleStartReview}
        isDetectingBranch={isDetectingBranch}
        isReviewRunning={stage === 'fetching' || stage === 'installing' || stage === 'staging' || stage === 'running'}
        detectedBranchInfo={detectedBranchInfo}
        onUrlBlurOrSelect={handleUrlBlurOrSelect}
      />

      {/* Pipeline Status Indicator */}
      <StatusTimeline
        stage={stage}
        commitSha={commitSha}
        error={error}
        hasReport={reports.length > 0}
        onOpenReport={() => setShowReportModal(true)}
      />

      {/* Full Width Log Console */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
        <LogConsole
          logs={logs}
          stage={stage}
          onAbort={handleAbortReview}
          onClearLogs={() => setLogs([])}
        />
      </div>

      {/* Full-Screen Report Lightbox Modal */}
      <ReportViewer
        reports={reports}
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
      />
    </div>
  );
};
