import React, { useEffect, useRef, useState } from 'react';
import { HistoryEntry } from '../../shared/types';
import { History, Play, GitBranch, RefreshCw, AlertCircle, Folder, FileText, GitCompare } from 'lucide-react';
import { BranchBadgeList } from './BranchBadgeList';
import { HistoryDropdownMenu } from './HistoryDropdownMenu';

interface DiffInputFormProps {
  gitUrl: string;
  setGitUrl: (url: string) => void;
  baseBranch: string;
  setBaseBranch: (branch: string) => void;
  compareBranch: string;
  setCompareBranch: (branch: string) => void;
  changeSpec: string;
  setChangeSpec: (spec: string) => void;
  history: HistoryEntry[];
  availableBranches?: string[];
  onStartDiffReview: () => void;
  isDetectingBranch: boolean;
  isReviewRunning: boolean;
  detectedBranchInfo: { isFallback?: boolean; error?: string } | null;
  onUrlBlurOrSelect: (url: string) => void;
}

export const DiffInputForm: React.FC<DiffInputFormProps> = ({
  gitUrl,
  setGitUrl,
  baseBranch,
  setBaseBranch,
  compareBranch,
  setCompareBranch,
  changeSpec,
  setChangeSpec,
  history,
  availableBranches = [],
  onStartDiffReview,
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
      window.api.getStagingDir().then((dir) => {
        if (dir) setStagingDirInput(dir);
      });
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
    setCompareBranch(item.lastBranch);
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
      const res = await window.api.setStagingDir(stagingDirInput.trim());
      if (res && res.stagingDir) {
        setStagingDirInput(res.stagingDir);
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
    if (baseBranch) {
      return (
        <span className="field-hint" style={{ color: 'var(--status-success)' }}>
          Auto-detected
        </span>
      );
    }
    return null;
  };

  const isSubmitDisabled =
    isReviewRunning ||
    !gitUrl.trim() ||
    !baseBranch.trim() ||
    !compareBranch.trim() ||
    isDetectingBranch;

  return (
    <div className="glass-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!isSubmitDisabled) {
            onStartDiffReview();
          }
        }}
        className="form-grid"
      >
        {/* Git Repository URL Input */}
        <div className="field-group" ref={dropdownRef} style={{ gridColumn: '1 / -1' }}>
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

        {/* Shared Datalist for Available Branches */}
        {availableBranches.length > 0 && (
          <datalist id="diff-branch-list">
            {availableBranches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        )}

        {/* Base Branch Input */}
        <div className="field-group">
          <label className="field-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <GitBranch size={14} /> Base Branch (Target)
            </span>
            {renderBranchStatusHint()}
          </label>
          <div className="input-wrapper">
            <input
              type="text"
              className="text-input"
              placeholder="main"
              list="diff-branch-list"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={isReviewRunning}
              required
            />
          </div>
          <BranchBadgeList
            label="Select Base"
            branches={availableBranches}
            selectedBranch={baseBranch}
            onSelectBranch={setBaseBranch}
            disabled={isReviewRunning}
          />
        </div>

        {/* Compare Branch Input */}
        <div className="field-group">
          <label className="field-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <GitCompare size={14} /> Compare Branch (Feature/PR)
            </span>
            <span className="field-hint">Feature or PR branch to evaluate</span>
          </label>
          <div className="input-wrapper">
            <input
              type="text"
              className="text-input"
              placeholder="feature/JIRA-1234"
              list="diff-branch-list"
              value={compareBranch}
              onChange={(e) => setCompareBranch(e.target.value)}
              disabled={isReviewRunning}
              required
            />
          </div>
          <BranchBadgeList
            label="Select Compare"
            branches={availableBranches}
            selectedBranch={compareBranch}
            onSelectBranch={setCompareBranch}
            disabled={isReviewRunning}
          />
        </div>

        {/* Change Specification TextArea */}
        <div className="field-group" style={{ gridColumn: '1 / -1' }}>
          <label className="field-label">
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <FileText size={14} /> Change Specification (JIRA Description / PR Specs)
            </span>
            <span className="field-hint">User requirement, JIRA ticket details, or acceptance criteria</span>
          </label>
          <textarea
            className="textarea-input"
            placeholder="e.g. JIRA-1234: Add retry mechanism and rate-limiting to API client..."
            value={changeSpec}
            onChange={(e) => setChangeSpec(e.target.value)}
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

        {/* Start Diff Review Trigger */}
        <button
          type="submit"
          className="btn-primary"
          disabled={isSubmitDisabled}
        >
          <Play size={16} />
          <span>{isReviewRunning ? 'Diff Review in Progress...' : 'Start Diff Review'}</span>
        </button>
      </form>
    </div>
  );
};
