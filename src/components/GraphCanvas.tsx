import { useCallback, useEffect, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import { CellNode, JoinNode } from "./CellNode";
import { TransitionEdge } from "./TransitionEdge";
import { manifestToGraph } from "../lib/graph";
import type { CellNodeData, TransitionEdgeData } from "../lib/graph";
import type { Cell, CellProgress } from "../types";

const nodeTypes = { cellNode: CellNode, joinNode: JoinNode };
const edgeTypes = { transitionEdge: TransitionEdge };

interface GraphCanvasProps {
  manifestBody: string;
  cells: Cell[];
  cellProgress: Record<string, CellProgress>;
  onNodeClick?: (stepName: string, cellId: string, nodeData: CellNodeData) => void;
}

export function GraphCanvas({ manifestBody, cells, cellProgress, onNodeClick }: GraphCanvasProps) {
  const { nodes: baseNodes, edges: baseEdges } = useMemo(
    () => manifestToGraph(manifestBody, cells),
    [manifestBody, cells],
  );

  // Merge cellProgress into node data
  const mergedNodes = useMemo(() => {
    if (Object.keys(cellProgress).length > 0) {
      console.log("[GraphCanvas] cellProgress keys:", Object.keys(cellProgress));
      console.log("[GraphCanvas] node cellIds:", baseNodes.map(n => (n.data as CellNodeData).cellId));
    }
    return baseNodes.map((node) => {
      const d = node.data as CellNodeData;
      const progress = cellProgress[d.cellId];
      if (progress) {
        return {
          ...node,
          data: {
            ...d,
            status: progress.status,
            progressMessage: progress.message,
            progressAttempt: progress.attempt,
          },
        };
      }
      return node;
    });
  }, [baseNodes, cellProgress]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CellNodeData>>(mergedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<TransitionEdgeData>>(baseEdges);

  // Keep nodes/edges in sync when props change (manifest refresh or progress update)
  useEffect(() => {
    setNodes(mergedNodes);
  }, [mergedNodes, setNodes]);

  useEffect(() => {
    setEdges(baseEdges);
  }, [baseEdges, setEdges]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as unknown as CellNodeData;
      onNodeClick?.(d.label, d.cellId, d);
    },
    [onNodeClick],
  );

  return (
    <div className="flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#2e303a" />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            const d = node.data as unknown as CellNodeData;
            switch (d.status) {
              case "implemented": return "#22c55e";
              case "stub": return "#eab308";
              case "failing": return "#ef4444";
              case "implementing": return "#8b5cf6";
              case "testing": return "#3b82f6";
              case "fixing": return "#f97316";
              default: return "#6b7280";
            }
          }}
          maskColor="rgba(15, 17, 23, 0.8)"
        />
      </ReactFlow>
    </div>
  );
}
