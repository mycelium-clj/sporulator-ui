import { useEffect, useState, useCallback } from "react";
import { getCell } from "../lib/api";
import type { Cell, CellProgress } from "../types";
import type { CellNodeData } from "../lib/graph";

interface CellModalProps {
  stepName: string;
  cellId: string;
  nodeData: CellNodeData;
  progress: CellProgress | null;
  onClose: () => void;
}

export function CellModal({ stepName, cellId, nodeData, progress, onClose }: CellModalProps) {
  const [cell, setCell] = useState<Cell | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"code" | "schema">("schema");

  useEffect(() => {
    setLoading(true);
    getCell(cellId)
      .then((c) => {
        setCell(c);
        if (c.Handler && c.Handler !== "") {
          setActiveTab("code");
        }
      })
      .catch(() => {
        // Cell not in store yet — fall back to manifest node data
        setCell(null);
      })
      .finally(() => setLoading(false));
  }, [cellId]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Derive display values from API cell or manifest node data
  const doc = cell?.Doc || nodeData.doc || "";
  const handler = cell?.Handler || "";
  const requires = cell
    ? (cell.Requires && cell.Requires !== "" && cell.Requires !== "[]" ? cell.Requires : "")
    : (nodeData.requires.length > 0 ? `[${nodeData.requires.map(r => `:${r}`).join(" ")}]` : "");

  // Schema: from API cell (EDN string) or from manifest node data (JS object)
  const schemaStr = cell?.Schema && cell.Schema !== ""
    ? cell.Schema
    : nodeData.schema
      ? formatSchemaObj(nodeData.schema)
      : "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-bg-panel border border-border rounded-xl shadow-2xl w-[720px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-text-bright text-base font-medium">{stepName}</h2>
            <span className="text-xs text-accent font-mono">{cellId}</span>
          </div>
          <button
            onClick={onClose}
            className="text-text hover:text-text-bright transition-colors p-1"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Progress banner */}
        {progress && (progress.status === "implementing" || progress.status === "testing" || progress.status === "fixing") && (
          <div className="px-5 py-2 border-b border-border bg-violet-500/5 flex items-center gap-2 shrink-0">
            <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-violet-400 font-medium">
              {progress.status === "implementing" && "Implementing..."}
              {progress.status === "testing" && "Running tests..."}
              {progress.status === "fixing" && "Fixing issues..."}
              {progress.attempt != null && progress.attempt > 1 && ` (attempt ${progress.attempt})`}
            </span>
            {progress.message && (
              <span className="text-xs text-text/40 truncate ml-1">{progress.message}</span>
            )}
          </div>
        )}
        {progress && progress.status === "failing" && (
          <div className="px-5 py-2 border-b border-border bg-status-red/5 flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-status-red shrink-0" />
            <span className="text-xs text-status-red font-medium">Tests failing</span>
            {progress.message && (
              <span className="text-xs text-text/40 truncate ml-1">{progress.message}</span>
            )}
          </div>
        )}
        {progress && progress.status === "implemented" && (
          <div className="px-5 py-2 border-b border-border bg-status-green/5 flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-status-green shrink-0" />
            <span className="text-xs text-status-green font-medium">Implemented</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border px-5 shrink-0">
          <button
            onClick={() => setActiveTab("code")}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "code"
                ? "border-accent text-accent"
                : "border-transparent text-text hover:text-text-bright"
            }`}
          >
            Handler
          </button>
          <button
            onClick={() => setActiveTab("schema")}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === "schema"
                ? "border-accent text-accent"
                : "border-transparent text-text hover:text-text-bright"
            }`}
          >
            Schema
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-text">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            </div>
          ) : (
            <div className="p-5">
              {doc && (
                <p className="text-sm text-text mb-4">{doc}</p>
              )}

              {activeTab === "code" ? (
                handler !== "" ? (
                  <pre className="bg-bg rounded-lg border border-border p-4 text-xs text-text-bright font-mono leading-relaxed overflow-x-auto whitespace-pre">
                    {handler}
                  </pre>
                ) : (
                  <div className="bg-bg rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm mb-2">No implementation yet</div>
                    <div className="text-xs text-text/25">This cell is a stub</div>
                  </div>
                )
              ) : (
                schemaStr !== "" ? (
                  <pre className="bg-bg rounded-lg border border-border p-4 text-xs text-text-bright font-mono leading-relaxed overflow-x-auto whitespace-pre">
                    {formatEdnSchema(schemaStr)}
                  </pre>
                ) : (
                  <div className="bg-bg rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm mb-2">No schema defined</div>
                    <div className="text-xs text-text/25">Schema will be generated with the cell</div>
                  </div>
                )
              )}

              {/* Metadata footer */}
              <div className="flex items-center gap-4 mt-4 text-xs text-text/40">
                {cell && <span>v{cell.Version}</span>}
                {cell?.CreatedBy && <span>by {cell.CreatedBy}</span>}
                {!cell && <span className="text-status-yellow">not yet in store</span>}
                {requires && (
                  <span className="font-mono">requires {requires}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Convert a JS schema object (from manifest parsing) to EDN-like string
function formatSchemaObj(schema: { input: Record<string, unknown>; output: Record<string, unknown> }): string {
  return `{:input  ${objToEdn(schema.input)}\n :output ${objToEdn(schema.output)}}`;
}

function objToEdn(obj: unknown, depth = 0): string {
  if (obj === null || obj === undefined) return "nil";
  if (typeof obj === "string") return `:${obj}`;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    const items = obj.map(v => objToEdn(v, depth + 1));
    return `[${items.join(" ")}]`;
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const indent = "  ".repeat(depth + 1);
    const lines = entries.map(([k, v]) => `${indent}:${k} ${objToEdn(v, depth + 1)}`);
    return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`;
  }
  return String(obj);
}

// Pretty-print an EDN schema string
function formatEdnSchema(raw: string): string {
  if (!raw) return "(no schema)";
  let depth = 0;
  let result = "";
  let inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && (i === 0 || raw[i - 1] !== "\\")) {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString) {
      result += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      result += ch + "\n" + "  ".repeat(depth);
    } else if (ch === "}" || ch === "]") {
      depth--;
      result += "\n" + "  ".repeat(depth) + ch;
    } else if (ch === "," || (ch === " " && i + 1 < raw.length && raw[i + 1] === ":")) {
      result += "\n" + "  ".repeat(depth);
    } else {
      result += ch;
    }
  }
  return result;
}
