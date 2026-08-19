import React from 'react';
import { HistoryEntry } from '../../shared/types';

interface HistoryDropdownMenuProps {
  history: HistoryEntry[];
  onSelect: (item: HistoryEntry) => void;
}

export const HistoryDropdownMenu: React.FC<HistoryDropdownMenuProps> = ({ history, onSelect }) => {
  if (history.length === 0) return null;

  const now = Date.now();
  const formatTimeAgo = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const diffMinutes = Math.floor((now - date.getTime()) / 60000);
      if (diffMinutes < 60) return `${diffMinutes} mins ago`;
      const diffHours = Math.floor(diffMinutes / 60);
      if (diffHours < 24) return `${diffHours} hours ago`;
      return `${Math.floor(diffHours / 24)} days ago`;
    } catch {
      return '';
    }
  };

  return (
    <div className="dropdown-menu">
      <div
        style={{
          padding: '0.4rem 0.8rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--text-dim)',
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        Recent Repositories
      </div>
      {history.map((item, idx) => (
        <div key={idx} className="dropdown-item" onClick={() => onSelect(item)}>
          <div className="dropdown-url">{item.gitUrl}</div>
          <div className="dropdown-meta">
            Branch: <span style={{ color: 'var(--accent-cyan)' }}>{item.lastBranch}</span> •{' '}
            {formatTimeAgo(item.lastReviewedAt)}
          </div>
        </div>
      ))}
    </div>
  );
};
