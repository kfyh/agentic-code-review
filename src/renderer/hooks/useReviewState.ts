import { useEffect, useState } from 'react';
import {
  HistoryEntry,
  LogEntry,
  ReviewMode,
  ReviewReport,
  ReviewStage,
  ReviewStateUpdate,
} from '../../shared/types';

export function useReviewState(
  mode: ReviewMode,
  setBranch: React.Dispatch<React.SetStateAction<string>>,
  setCompareBranch: React.Dispatch<React.SetStateAction<string>>
) {
  const [stage, setStage] = useState<ReviewStage>('idle');
  const [commitSha, setCommitSha] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [reports, setReports] = useState<ReviewReport[]>([]);
  const [showReportModal, setShowReportModal] = useState<boolean>(false);

  // Subscribe to IPC updates
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
        window.api
          .getReports(update.commitSha)
          .then((res) => {
            setReports(res);
            setShowReportModal(true);
          })
          .catch(console.error);
        window.api.getHistory().then(setHistory).catch(console.error);
      }
    });

    const unsubscribeLog = window.api.onLogEntry((log: LogEntry) => {
      setLogs((prev) => [...prev, log]);
    });

    return () => {
      unsubscribeState();
      unsubscribeLog();
    };
  }, [mode, setBranch, setCompareBranch]);

  const resetForNewReview = () => {
    setError(undefined);
    setReports([]);
    setLogs([]);
    setShowReportModal(false);
    setStage('fetching');
  };

  const isReviewRunning =
    stage === 'fetching' ||
    stage === 'installing' ||
    stage === 'staging' ||
    stage === 'running';

  return {
    stage,
    setStage,
    commitSha,
    setCommitSha,
    error,
    setError,
    history,
    setHistory,
    logs,
    setLogs,
    reports,
    setReports,
    showReportModal,
    setShowReportModal,
    isReviewRunning,
    resetForNewReview,
  };
}
