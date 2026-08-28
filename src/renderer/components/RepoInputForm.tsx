import React, { useEffect, useRef, useState } from 'react';
import { HistoryEntry } from '../../shared/types';
import { History, Play, GitBranch, RefreshCw, AlertCircle, Folder } from 'lucide-react';
import { BranchBadgeList } from './BranchBadgeList';
import { HistoryDropdownMenu } from './HistoryDropdownMenu';

interface RepoInputFormProps {
  gitUrl: string;
  setGitUrl: (url: string) => void;
  branch: string;
  setBranch: (branch: string) => void;
  history: HistoryEntry[];
  availableBranches?: string[];
  onStartReview: () => void;
  isDetectingBranch: boolean;
  isReviewRunning: boolean;
  detectedBranchInfo: { isFallback?: boolean; error?: string } | null;
  onUrlBlurOrSelect: (url: string) => void;
}

export const RepoInputForm: React.FC<RepoInputFormProps> = ({
  gitUrl,
  setGitUrl,
  branch,
  setBranch,
  history,
  availableBranches = [],
  onStartReview,
  isDetectingBranch,
  isReviewRunning,
  detectedBranchInfo,
  onUrlBlurOrSelect,
}) => {
  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false);
  const [stagingDirInput, setStagingDirInput] = useState<string>('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.api && window.api.getStagingDir) {
      window.api
        .getStagingDir()
        .then((dir) => {
          if (dir) setStagingDirInput(dir);
        })
        .catch(console.error);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setShowHistoryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectHistoryItem = (item: HistoryEntry) => {
    setGitUrl(item.gitUrl);
    setBranch(item.lastBranch);
    setShowHistoryDropdown(false);
    onUrlBlurOrSelect(item.gitUrl);
  };

  const handleUrlBlur = () => {
    if (gitUrl.trim()) {
      onUrlBlurOrSelect(gitUrl.trim());
    }
  };

  const handleStagingDirBlur = async () => {
    if (window.api && window.api.setStagingDir) {
      try {
        const res = await window.api.setStagingDir(stagingDirInput.trim());
        if (res && res.stagingDir) {
          setStagingDirInput(res.stagingDir);
        }
      } catch (err) {
        console.error('Failed to set staging directory:', err);
      }
    }
  };

  const renderBranchStatusHint = () => {
    if (isDetectingBranch) {
      return (
        <span className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <RefreshCw size={12} className="spin" /> Detecting...
        </span>
      );
    }
    if (detectedBranchInfo?.isFallback) {
      return (
        <span
          className="field-hint"
          style={{
            color: 'var(--status-warn)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <AlertCircle size={12} /> Fallback
        </span>
      );
    }
    if (branch) {
      return (
        <span className="field-hint" style={{ color: 'var(--status-success)' }}>
          Auto-detected
        </span>
      );
    }
    return null;
  };

  const isSubmitDisabled = isReviewRunning || !gitUrl.trim() || !branch.trim() || isDetectingBranch;

  return (
    <div className="glass-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSubmitDisabled) {
            onStartReview();
          }
        }}
        className="form-grid"
      >
        {/* Git Repository URL Input */}
        <div className="field-group" ref={dropdownRef}>
          <label className="field-label">
            <span>Git Repository URL (SSH)</span>
            {history.length > 0 && (
              <button
                type="button"
                className="field-hint"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                onClick={() => setShowHistoryDropdown(!showHistoryDropdown)}
              >
                <History size={12} />
                <span>Recent Repos ({history.length})</span>
              </button>
            )}
          </label>
          <div className="input-wrapper">
            <input
              type="text"
              className="text-input"
              placeholder="git@github.com:owner/repo.git"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              onBlur={handleUrlBlur}
              onFocus={() => {
                if (history.length > 0) setShowHistoryDropdown(true);
              }}
              disabled={isReviewRunning}
              required
            />
          </div>

          {/* History Dropdown Menu */}
          {showHistoryDropdown && (
            <HistoryDropdownMenu history={history} onSelect={handleSelectHistoryItem} />
          )}
        </div>

        {/* Target Branch Name Input */}
        <div className="field-group">
          <label className="field-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <GitBranch size={14} /> Branch Name
            </span>
            {renderBranchStatusHint()}
          </label>
          <div className="input-wrapper">
            <input
              type="text"
              className="text-input"
              placeholder="main"
              list="repo-branch-list"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              disabled={isReviewRunning}
              required
            />
            {availableBranches.length > 0 && (
              <datalist id="repo-branch-list">
                {availableBranches.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            )}
          </div>
          <BranchBadgeList
            label="Available"
            branches={availableBranches}
            selectedBranch={branch}
            onSelectBranch={setBranch}
            disabled={isReviewRunning}
          />
        </div>

        {/* Staging Area Directory Config */}
        <div className="field-group" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Folder size={14} /> Staging Directory
            </span>
            <span className="field-hint">Application Staging Area Path</span>
          </label>
          <div className="input-wrapper">
            <input
              type="text"
              className="text-input"
              placeholder="Configurable staging path (e.g. /workspace/staging)"
              value={stagingDirInput}
              onChange={(e) => setStagingDirInput(e.target.value)}
              onBlur={handleStagingDirBlur}
              disabled={isReviewRunning}
            />
          </div>
        </div>

        {/* Start Review Trigger */}
        <button type="submit" className="btn-primary" disabled={isSubmitDisabled}>
          <Play size={16} />
          <span>{isReviewRunning ? 'Review in Progress...' : 'Start Code Review'}</span>
        </button>
      </form>
    </div>
  );
};
