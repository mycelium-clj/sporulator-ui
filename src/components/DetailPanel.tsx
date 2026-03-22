import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import type { ChatMessage } from "../types";

interface DetailPanelProps {
  messages: ChatMessage[];
  streaming: boolean;
  streamContent: string;
  onSendMessage: (message: string) => void;
  onClear?: () => void;
}

export function DetailPanel({
  messages,
  streaming,
  streamContent,
  onSendMessage,
  onClear,
}: DetailPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    onSendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <span className="font-medium text-sm">Workflow Chat</span>
        {onClear && messages.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-[var(--color-text)]/40 hover:text-[var(--color-text)] uppercase tracking-wider"
          >
            Clear
          </button>
        )}
      </div>

      {/* Message history */}
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === "user"
                ? "bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20"
                : "bg-[var(--color-bg-panel)]"
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text)]/40 mb-1">
              {msg.role === "user" ? "You" : "Agent"}
            </div>
            <div className="prose prose-sm prose-invert max-w-none">
              <Markdown>{msg.content}</Markdown>
            </div>
          </div>
        ))}

        {/* Current streaming response */}
        {streaming && (
          <div className="text-sm rounded-lg px-3 py-2 bg-[var(--color-bg-panel)]">
            <div className="text-[10px] uppercase tracking-wider text-[var(--color-text)]/40 mb-1 flex items-center gap-1">
              Agent
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
            {streamContent ? (
              <div className="prose prose-sm prose-invert max-w-none">
                <Markdown>{streamContent}</Markdown>
              </div>
            ) : (
              <div className="text-[var(--color-text)]/30 text-xs italic">
                Thinking...
              </div>
            )}
          </div>
        )}

        {messages.length === 0 && !streaming && (
          <div className="text-sm text-[var(--color-text)]/40 text-center py-8">
            Describe changes to the workflow
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t border-[var(--color-border)] p-3">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Suggest changes..."
            disabled={streaming}
            rows={2}
            className="flex-1 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={streaming || !input.trim()}
            className="px-3 py-2 bg-[var(--color-accent)] text-white rounded-lg text-sm font-medium disabled:opacity-30 hover:opacity-90 self-end"
          >
            Send
          </button>
        </div>
        <div className="text-[10px] text-[var(--color-text)]/30 mt-1">
          ⌘+Enter to send
        </div>
      </div>
    </div>
  );
}
