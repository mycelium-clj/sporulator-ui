import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";

interface AgentStreamProps {
  content: string;
  isStreaming: boolean;
  onFollowUp: (message: string) => void;
  onClearContext: () => void;
}

export function AgentStream({ content, isStreaming, onFollowUp, onClearContext }: AgentStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [followUp, setFollowUp] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  const handleSend = () => {
    const trimmed = followUp.trim();
    if (trimmed) {
      onFollowUp(trimmed);
      setFollowUp("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-xs text-text-bright font-medium">Graph Agent</span>
        {isStreaming && (
          <div className="w-2 h-2 border border-accent border-t-transparent rounded-full animate-spin" />
        )}
        <div className="flex-1" />
        {!isStreaming && (
          <button
            onClick={onClearContext}
            className="text-[10px] text-text/40 hover:text-status-red transition-colors"
            title="Clear conversation history"
          >
            Clear
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {content ? (
          <div className="agent-markdown text-xs text-text leading-relaxed">
            <Markdown>{content}</Markdown>
          </div>
        ) : isStreaming ? (
          <div className="text-xs text-text/50">Thinking...</div>
        ) : null}
      </div>

      {!isStreaming && (
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Follow up..."
              className="flex-1 bg-bg-node border border-border rounded px-3 py-1.5 text-xs text-text-bright placeholder:text-text/30 focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={handleSend}
              disabled={!followUp.trim()}
              className="px-3 py-1.5 bg-accent/20 text-accent rounded text-xs hover:bg-accent/30 disabled:opacity-30 transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
