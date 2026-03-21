import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { CellNodeData } from "../lib/graph";

const STATUS_COLORS: Record<string, string> = {
  implemented: "bg-status-green",
  stub: "bg-status-yellow",
  failing: "bg-status-red",
  "no-schema": "bg-status-gray",
  implementing: "bg-violet-500",
  testing: "bg-blue-500",
  fixing: "bg-orange-500",
};

const STATUS_BORDERS: Record<string, string> = {
  implemented: "border-status-green/30",
  stub: "border-status-yellow/30",
  failing: "border-status-red/30",
  "no-schema": "border-border",
  implementing: "border-violet-500/30",
  testing: "border-blue-500/30",
  fixing: "border-orange-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  implementing: "implementing...",
  testing: "testing...",
  fixing: "fixing...",
};

function schemaKeys(schema: Record<string, unknown> | null | undefined): string {
  if (!schema) return "";
  const keys = Object.keys(schema);
  if (keys.length === 0) return "";
  if (keys.length <= 3) return keys.map((k) => `:${k}`).join(" ");
  return keys.slice(0, 2).map((k) => `:${k}`).join(" ") + ` +${keys.length - 2}`;
}

const isActive = (status: string) =>
  status === "implementing" || status === "testing" || status === "fixing";

export function CellNode({ data }: NodeProps) {
  const d = data as unknown as CellNodeData;
  const borderClass = STATUS_BORDERS[d.status] || "border-border";
  const dotClass = STATUS_COLORS[d.status] || "bg-status-gray";
  const inputKeys = schemaKeys(d.schema?.input);
  const outputKeys = schemaKeys(d.schema?.output);
  const active = isActive(d.status);
  const progressMsg = (d as Record<string, unknown>).progressMessage as string | undefined;
  const attempt = (d as Record<string, unknown>).progressAttempt as number | undefined;

  return (
    <div
      className={`bg-bg-node border ${borderClass} rounded-lg px-3 py-2 min-w-[200px] max-w-[260px] shadow-lg hover:border-border-hover transition-colors ${active ? "ring-1 ring-violet-500/20" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />

      <div className="flex items-center gap-2 mb-1">
        {active ? (
          <span className={`w-2 h-2 rounded-full ${dotClass} shrink-0 animate-pulse`} />
        ) : (
          <span className={`w-2 h-2 rounded-full ${dotClass} shrink-0`} />
        )}
        <span className="text-text-bright text-sm font-medium truncate">{d.label}</span>
      </div>

      {active && (
        <div className="flex items-center gap-1.5 mb-1">
          <div className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin text-violet-400" />
          <span className="text-xs text-violet-400 truncate">
            {STATUS_LABELS[d.status]}
            {attempt != null && attempt > 1 && ` (attempt ${attempt})`}
          </span>
        </div>
      )}

      {active && progressMsg && (
        <p className="text-text/50 text-[10px] truncate mb-1">{progressMsg}</p>
      )}

      {!active && d.doc && (
        <p className="text-text text-xs truncate mb-1">{d.doc}</p>
      )}

      {d.schema && (
        <div className="text-xs font-mono space-y-0.5">
          {inputKeys && (
            <div className="text-status-green/70 truncate">
              <span className="text-text/50">in:</span> {inputKeys}
            </div>
          )}
          {outputKeys && (
            <div className="text-accent/70 truncate">
              <span className="text-text/50">out:</span> {outputKeys}
            </div>
          )}
        </div>
      )}

      {d.requires.length > 0 && (
        <div className="text-xs text-text/40 mt-1 truncate">
          {d.requires.map((r) => `:${r}`).join(" ")}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
    </div>
  );
}

export function JoinNode({ data }: NodeProps) {
  const d = data as unknown as CellNodeData;

  return (
    <div className="bg-bg-node border border-accent/20 rounded-lg px-3 py-2 min-w-[160px] shadow-lg border-dashed">
      <Handle type="target" position={Position.Top} className="!bg-accent !w-2 !h-2 !border-0" />

      <div className="flex items-center gap-2">
        <span className="text-accent text-sm">&#x2225;</span>
        <span className="text-accent text-sm font-medium">{d.label}</span>
      </div>
      <p className="text-text text-xs">{d.doc}</p>

      <Handle type="source" position={Position.Bottom} className="!bg-accent !w-2 !h-2 !border-0" />
    </div>
  );
}
