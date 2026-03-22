import { useState } from "react";
import Markdown from "react-markdown";

interface StepsPreviewProps {
  content: string;
  isStreaming: boolean;
  onApprove?: (feedback?: string) => void;
}

export function StepsPreview({ content, isStreaming, onApprove }: StepsPreviewProps) {
  const [feedback, setFeedback] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);

  const handleApprove = () => {
    onApprove?.();
  };

  const handleSendFeedback = () => {
    const text = feedback.trim();
    if (text) {
      onApprove?.(text);
      setFeedback("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSendFeedback();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="font-medium text-sm">
          {isStreaming ? "Analyzing Requirements..." : "Step Breakdown"}
        </span>
        {isStreaming && (
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <Markdown>{content}</Markdown>
        </div>
      </div>

      {/* Approve / Feedback controls — only when not streaming */}
      {!isStreaming && onApprove && content && (
        <div className="border-t border-[var(--color-border)] p-4 space-y-3">
          {showFeedback ? (
            <div className="space-y-2">
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what to change..."
                rows={3}
                autoFocus
                className="w-full bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-accent)]"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowFeedback(false); setFeedback(""); }}
                  className="px-3 py-1.5 text-sm text-[var(--color-text)]/60 hover:text-[var(--color-text)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendFeedback}
                  disabled={!feedback.trim()}
                  className="px-3 py-1.5 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium disabled:opacity-30 hover:opacity-90"
                >
                  Revise &amp; Build
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setShowFeedback(true)}
                className="flex-1 px-3 py-2 border border-[var(--color-border)] text-[var(--color-text)] rounded-lg text-sm hover:border-[var(--color-accent)]/50 transition-colors"
              >
                Suggest Changes
              </button>
              <button
                onClick={handleApprove}
                className="flex-1 px-3 py-2 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded-lg text-sm font-medium hover:bg-[var(--color-accent)]/30 transition-colors"
              >
                Approve &amp; Build Manifest
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
