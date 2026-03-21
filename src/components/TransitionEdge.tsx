import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
} from "@xyflow/react";
import type { EdgeProps } from "@xyflow/react";
import type { TransitionEdgeData } from "../lib/graph";

export function TransitionEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data } = props;
  const d = data as unknown as TransitionEdgeData;
  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const hasLabel = d?.label && d.label.length > 0;
  const hasKeys = d?.keys && d.keys.length > 0;

  return (
    <>
      {/* Invisible wider path for hover target */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        path={edgePath}
        style={{
          stroke: hovered ? "var(--color-accent)" : "var(--color-edge)",
          strokeWidth: hovered ? 2 : 1.5,
          transition: "stroke 0.15s, stroke-width 0.15s",
        }}
      />
      {(hasLabel || (hovered && hasKeys)) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="text-xs"
          >
            {hasLabel && (
              <span className="bg-bg-panel border border-border rounded px-1.5 py-0.5 text-edge-label">
                {d.label}
              </span>
            )}
            {hovered && hasKeys && (
              <div className="bg-bg-panel border border-border rounded px-1.5 py-0.5 mt-1 text-accent/70 font-mono whitespace-nowrap">
                {d.keys.map((k) => `:${k}`).join(" ")}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
