import React from 'react';

interface BranchBadgeListProps {
  label: string;
  branches: string[];
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  disabled?: boolean;
}

export const BranchBadgeList: React.FC<BranchBadgeListProps> = ({
  label,
  branches,
  selectedBranch,
  onSelectBranch,
  disabled = false,
}) => {
  if (branches.length === 0) return null;

  return (
    <div
      style={{
        marginTop: '0.4rem',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{label}:</span>
      {branches.slice(0, 5).map((b) => {
        const isSelected = selectedBranch === b;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onSelectBranch(b)}
            disabled={disabled}
            style={{
              background: isSelected ? 'var(--accent-cyan-subtle)' : 'var(--bg-glass)',
              border: `1px solid ${isSelected ? 'var(--accent-cyan)' : 'var(--border-color)'}`,
              borderRadius: '4px',
              color: isSelected ? 'var(--accent-cyan)' : 'var(--text-main)',
              fontSize: '0.75rem',
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            {b}
          </button>
        );
      })}
    </div>
  );
};
