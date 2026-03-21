interface DetailPanelProps {
  selectedStep: string | null;
  selectedCellId: string | null;
}

export function DetailPanel({ selectedStep, selectedCellId }: DetailPanelProps) {
  if (!selectedStep) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text/50 text-sm px-6 text-center gap-2">
        <div className="text-2xl mb-2">&#x25C9;</div>
        <div>Click a node to view details</div>
        <div className="text-xs text-text/30">
          Phase 2 will add the graph agent chat here
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <h2 className="text-text-bright text-lg font-medium">{selectedStep}</h2>
        {selectedCellId && (
          <div className="text-xs text-accent font-mono mt-1">{selectedCellId}</div>
        )}
      </div>

      <div className="text-xs text-text/50 border border-border rounded-lg p-4 text-center">
        Cell detail view coming in Phase 3
      </div>
    </div>
  );
}
