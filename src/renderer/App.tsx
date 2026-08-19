import React, { useEffect, useState } from 'react';
import {
  HistoryEntry,
  LogEntry,
  ReviewReport,
  ReviewStage,
  ReviewStateUpdate,
  ReviewMode,
} from '../shared/types';
import { LogConsole } from './components/LogConsole';
import { RepoInputForm } from './components/RepoInputForm';
import { DiffInputForm } from './components/DiffInputForm';
import { ReportViewer } from './components/ReportViewer';
import { StatusTimeline } from './components/StatusTimeline';
import { ShieldCheck, Code2, GitCompare } from 'lucide-react';

export const App: React.FC = () => {
  const [mode, setMode] = useState<ReviewMode>('single');

  // Flow 1 state
  const [gitUrl, setGitUrl] = useState<string>('');
  const [branch, setBranch] = useState<string>('');

  // Flow 2 state
  const [diffGitUrl, setDiffGitUrl] = useState<string>('');
  const [baseBranch, setBaseBranch] = useState<string>('');
  const [compareBranch, setCompareBranch] = useState<string>('');
  const [changeSpec, setChangeSpec] = useState<string>('');

  // Shared execution & UI state
  const [stage, setStage] = useState<ReviewStage>('idle');
  const [commitSha, setCommitSha] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);

  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [isDetectingBranch, setIsDetectingBranch] = useState<boolean>(false);
  const [detectedBranchInfo, setDetectedBranchInfo] = useState<{
    isFallback?: boolean;
    error?: string;
  } | null>(null);

  // Load initial repo history
  useEffect(() => {
    const loadHistory = async () => {
      try {
        if (window.api && window.api.getHistory) {
          const items = await window.api.getHistory();
          setHistory(items);
          if (items.length > 0) {
            const initialUrl = items[0].gitUrl;
            setGitUrl((prev) => prev || initialUrl);
            setBranch((prev) => prev || items[0].lastBranch);
            setDiffGitUrl((prev) => prev || initialUrl);
            setCompareBranch((prev) => prev || items[0].lastBranch);
            handleUrlBlurOrSelect(initialUrl, mode);
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
      if (update.branch) {
        if (mode === 'single') setBranch(update.branch);
        else setCompareBranch(update.branch);
      }
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
  }, [mode]);

  // Handle URL blur / history selection to detect remote default branch and available branches
  const handleUrlBlurOrSelect = async (url: string, targetMode: ReviewMode = mode) => {
    if (!url || !url.trim() || !window.api) return;
    setIsDetectingBranch(true);
    setDetectedBranchInfo(null);

    try {
      const [detectRes, branchesRes] = await Promise.all([
        window.api.detectBranch(url.trim()),
        window.api.getBranches ? window.api.getBranches(url.trim()) : Promise.resolve({ success: false, branches: [] }),
      ]);

      setIsDetectingBranch(false);

      if (branchesRes.success && branchesRes.branches.length > 0) {
        setAvailableBranches(branchesRes.branches);
      } else {
        setAvailableBranches([]);
      }

      if (detectRes.success && detectRes.branch) {
        if (targetMode === 'single') {
          setBranch(detectRes.branch);
        } else {
          setBaseBranch(detectRes.branch);
        }
        setDetectedBranchInfo({ isFallback: detectRes.isFallback });
      } else {
        const defaultBranch = branchesRes.branches?.[0] || 'main';
        if (targetMode === 'single') setBranch(defaultBranch);
        else setBaseBranch(defaultBranch);
        setDetectedBranchInfo({ isFallback: true, error: detectRes.error });
      }
    } catch (err: unknown) {
      setIsDetectingBranch(false);
      setDetectedBranchInfo({
        isFallback: true,
        error: (err as Error)?.message || 'Branch detection query failed',
      });
    }
  };

  const handleModeSwitch = (newMode: ReviewMode) => {
    if (isReviewRunning) return;
    setMode(newMode);
    const targetUrl = newMode === 'diff' ? (diffGitUrl || gitUrl) : (gitUrl || diffGitUrl);
    if (targetUrl) {
      handleUrlBlurOrSelect(targetUrl, newMode);
    }
  };

  // Flow 1 Start review trigger
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

  // Flow 2 Start diff review trigger
  const handleStartDiffReview = async () => {
    if (
      !diffGitUrl.trim() ||
      !baseBranch.trim() ||
      !compareBranch.trim() ||
      !window.api
    )
      return;

    setError(undefined);
    setReports([]);
    setLogs([]);
    setShowReportModal(false);
    setStage('fetching');

    const res = await window.api.startDiffReview({
      gitUrl: diffGitUrl.trim(),
      baseBranch: baseBranch.trim(),
      compareBranch: compareBranch.trim(),
      changeSpec: changeSpec.trim(),
    });

    if (!res.success) {
      setError(res.error || 'Failed to start diff review process');
    }
  };

  // Abort trigger
  const handleAbortReview = async () => {
    if (window.api) {
      await window.api.abortReview();
    }
  };

  const isReviewRunning =
    stage === 'fetching' ||
    stage === 'installing' ||
    stage === 'staging' ||
    stage === 'running';

  return (
    <div className="app-container">
      {/* App Header & Mode Switcher */}
      <header className="app-header">
        <div className="app-title-group">
          <div className="app-logo">
            <ShieldCheck />
          </div>
          <div>
            <h1 className="app-title">Code Review App</h1>
            <p className="app-subtitle">
              {mode === 'single'
                ? 'Single Repository Automated Review Suite'
                : 'PR & Branch Diff Review Suite against Change Spec'}
            </p>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="mode-switcher">
          <button
            type="button"
            className={`mode-tab ${mode === 'single' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('single')}
            disabled={isReviewRunning}
          >
            <Code2 size={16} />
            <span>Single Repo Review</span>
          </button>
          <button
            type="button"
            className={`mode-tab ${mode === 'diff' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('diff')}
            disabled={isReviewRunning}
          >
            <GitCompare size={16} />
            <span>PR & Diff Review</span>
          </button>
        </div>
      </header>

      {/* Input Form based on Active Mode */}
      {mode === 'single' ? (
        <RepoInputForm
          gitUrl={gitUrl}
          setGitUrl={setGitUrl}
          branch={branch}
          setBranch={setBranch}
          history={history}
          availableBranches={availableBranches}
          onStartReview={handleStartReview}
          isDetectingBranch={isDetectingBranch}
          isReviewRunning={isReviewRunning}
          detectedBranchInfo={detectedBranchInfo}
          onUrlBlurOrSelect={(url) => handleUrlBlurOrSelect(url, 'single')}
        />
      ) : (
        <DiffInputForm
          gitUrl={diffGitUrl}
          setGitUrl={setDiffGitUrl}
          baseBranch={baseBranch}
          setBaseBranch={setBaseBranch}
          compareBranch={compareBranch}
          setCompareBranch={setCompareBranch}
          changeSpec={changeSpec}
          setChangeSpec={setChangeSpec}
          history={history}
          availableBranches={availableBranches}
          onStartDiffReview={handleStartDiffReview}
          isDetectingBranch={isDetectingBranch}
          isReviewRunning={isReviewRunning}
          detectedBranchInfo={detectedBranchInfo}
          onUrlBlurOrSelect={(url) => handleUrlBlurOrSelect(url, 'diff')}
        />
      )}

      {/* Pipeline Status Indicator (Reused 1:1) */}
      <StatusTimeline
        stage={stage}
        commitSha={commitSha}
        error={error}
        hasReport={reports.length > 0}
        onOpenReport={() => setShowReportModal(true)}
      />

      {/* Full Width Log Console (Reused 1:1) */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%' }}>
        <LogConsole
          logs={logs}
          stage={stage}
          onAbort={handleAbortReview}
          onClearLogs={() => setLogs([])}
        />
      </div>

      {/* Full-Screen Report Lightbox Modal (Reused 1:1) */}
      <ReportViewer
        reports={reports}
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
      />
    </div>
  );
};
