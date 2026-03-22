import Markdown from "react-markdown";

interface StepsPreviewProps {
  content: string;
  isStreaming: boolean;
}

export function StepsPreview({ content, isStreaming }: StepsPreviewProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="font-medium text-sm">Analyzing Requirements</span>
        {isStreaming && (
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="prose prose-sm prose-invert max-w-none">
          <Markdown>{content}</Markdown>
        </div>
      </div>
    </div>
  );
}
