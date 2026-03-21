import { useState } from "react";

interface RequirementsInputProps {
  onSubmit: (requirements: string) => void;
}

export function RequirementsInput({ onSubmit }: RequirementsInputProps) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (trimmed) onSubmit(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center px-8">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl text-text-bright font-medium">Sporulator</h1>
          <p className="text-sm text-text">
            Describe the workflow you want to build. The graph agent will design
            the cell graph for you.
          </p>
        </div>

        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Build an order processing workflow that validates input, checks inventory, computes tax, processes payment, and sends confirmation..."
            rows={6}
            autoFocus
            className="w-full bg-bg-node border border-border rounded-lg px-4 py-3 text-sm text-text-bright placeholder:text-text/30 resize-none focus:outline-none focus:border-accent/50 transition-colors"
          />

          <div className="flex items-center justify-between">
            <span className="text-xs text-text/30">
              {navigator.userAgent.includes("Mac") ? "Cmd" : "Ctrl"}+Enter to submit
            </span>
            <button
              onClick={handleSubmit}
              disabled={!text.trim()}
              className="px-4 py-2 bg-accent/20 text-accent rounded-lg text-sm font-medium hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Design Workflow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
