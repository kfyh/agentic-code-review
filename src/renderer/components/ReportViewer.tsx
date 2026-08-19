import React, { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { ReviewReport } from '../../shared/types';
import { FileText, X, FileCode, CheckCircle2, Download, Copy, Check } from 'lucide-react';

interface ReportViewerProps {
  reports: ReviewReport[];
  isOpen: boolean;
  onClose: () => void;
}

export const ReportViewer: React.FC<ReportViewerProps> = ({ reports, isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  // Handle Escape key press to dismiss modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentReport = reports[activeTab] || reports[0];

  const handleDownload = () => {
    if (!currentReport || !currentReport.content) return;
    const blob = new Blob([currentReport.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = currentReport.packageName.endsWith('.md')
      ? currentReport.packageName
      : `${currentReport.packageName}.md`;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!currentReport || !currentReport.content) return;
    try {
      await navigator.clipboard.writeText(currentReport.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy report to clipboard:', err);
    }
  };

  const renderSanitizedMarkdown = (content: string) => {
    try {
      const rawHtml = String(marked.parse(content));
      const cleanHtml = DOMPurify.sanitize(rawHtml);
      return { __html: cleanHtml };
    } catch {
      return { __html: '<p>Failed to render report markdown content.</p>' };
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title">
            <FileCode size={20} style={{ color: 'var(--accent-cyan)' }} />
            <span>Code Review Deliverable</span>
            {reports.length > 0 && (
              <span className="badge-count">
                {reports.length} {reports.length === 1 ? 'report' : 'reports'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {reports.length > 0 && (
              <>
                <button
                  type="button"
                  className="modal-action-btn"
                  onClick={handleCopy}
                  title="Copy Markdown to Clipboard"
                >
                  {copied ? <Check size={14} style={{ color: 'var(--status-success)' }} /> : <Copy size={14} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
                <button
                  type="button"
                  className="modal-action-btn"
                  onClick={handleDownload}
                  title="Save / Download Markdown File"
                  style={{
                    background: 'var(--accent-cyan-subtle)',
                    borderColor: 'var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                  }}
                >
                  <Download size={14} />
                  <span>Download</span>
                </button>
              </>
            )}
            <button className="modal-close-btn" onClick={onClose} title="Close Lightbox (Esc)">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Report Tabs (if multiple reports exist) */}
        {reports.length > 1 && (
          <div className="report-tabs">
            {reports.map((rep, idx) => (
              <button
                key={idx}
                className={`tab-button ${activeTab === idx ? 'active' : ''}`}
                onClick={() => setActiveTab(idx)}
              >
                <FileText size={14} />
                <span>{rep.packageName}.md</span>
              </button>
            ))}
          </div>
        )}

        {/* Modal Body / Report Content */}
        <div className="modal-body markdown-body">
          {reports.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                color: 'var(--text-muted)',
              }}
            >
              <CheckCircle2
                size={42}
                style={{ color: 'var(--status-success)', marginBottom: '0.75rem' }}
              />
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>Review Completed</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                No markdown reports were found in the output reports directory.
              </div>
            </div>
          ) : (
            <div dangerouslySetInnerHTML={renderSanitizedMarkdown(currentReport?.content || '')} />
          )}
        </div>
      </div>
    </div>
  );
};
