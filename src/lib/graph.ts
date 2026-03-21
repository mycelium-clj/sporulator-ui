import type { Node, Edge } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type { Cell, CellStatus } from "../types";
import { parseManifestEdn } from "./edn";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface CellNodeData {
  label: string;
  cellId: string;
  doc: string;
  schema: { input: Record<string, unknown>; output: Record<string, unknown> } | null;
  requires: string[];
  status: CellStatus;
  isJoinMember: boolean;
  joinGroup: string | null;
  [key: string]: unknown;
}

export interface TransitionEdgeData {
  label: string;
  keys: string[];
  [key: string]: unknown;
}

function getCellStatus(cellId: string, cells: Cell[]): CellStatus {
  const cell = cells.find((c) => c.ID === cellId);
  if (!cell) return "no-schema";
  if (!cell.Schema || cell.Schema === "" || cell.Schema === "{}") return "no-schema";
  if (!cell.Handler || cell.Handler === "") return "stub";
  return "implemented";
}

function summarizeSchema(schema: Record<string, unknown> | null | undefined): string {
  if (!schema) return "";
  const keys = Object.keys(schema);
  if (keys.length === 0) return "";
  if (keys.length <= 3) return keys.map((k) => `:${k}`).join(" ");
  return keys.slice(0, 3).map((k) => `:${k}`).join(" ") + " ...";
}

export function manifestToGraph(
  manifestBody: string,
  cells: Cell[],
): { nodes: Node<CellNodeData>[]; edges: Edge<TransitionEdgeData>[] } {
  const raw = parseManifestEdn(manifestBody) as Any;

  const cellDefs: Record<string, Any> = raw.cells || {};
  const edgesRaw: Record<string, Any> = raw.edges || {};
  const joins: Record<string, Any> | undefined = raw.joins;
  const pipeline: string[] | undefined = raw.pipeline;

  // Collect join membership
  const joinMembership = new Map<string, string>();
  if (joins) {
    for (const [joinName, join] of Object.entries(joins)) {
      for (const memberName of (join as Any).cells || []) {
        joinMembership.set(memberName as string, joinName);
      }
    }
  }

  // Build edges from pipeline shorthand
  const edgeMap: Record<string, Any> = { ...edgesRaw };
  if (pipeline && pipeline.length > 0) {
    for (let i = 0; i < pipeline.length - 1; i++) {
      edgeMap[pipeline[i]] = pipeline[i + 1];
    }
    edgeMap[pipeline[pipeline.length - 1]] = "end";
  }

  // Create nodes for each cell in the manifest
  const nodes: Node<CellNodeData>[] = [];

  for (const [stepName, cellDef] of Object.entries(cellDefs)) {
    const cellId = (cellDef.id as string) || stepName;
    const schema = cellDef.schema || null;

    nodes.push({
      id: stepName,
      type: "cellNode",
      position: { x: 0, y: 0 },
      data: {
        label: stepName,
        cellId,
        doc: (cellDef.doc as string) || "",
        schema,
        requires: (cellDef.requires as string[]) || [],
        status: getCellStatus(cellId, cells),
        isJoinMember: joinMembership.has(stepName),
        joinGroup: joinMembership.get(stepName) || null,
      },
    });
  }

  // Create join group nodes
  if (joins) {
    for (const [joinName, join] of Object.entries(joins)) {
      nodes.push({
        id: joinName,
        type: "joinNode",
        position: { x: 0, y: 0 },
        data: {
          label: joinName,
          cellId: "",
          doc: `${(join as Any).strategy} join`,
          schema: null,
          requires: [],
          status: "implemented",
          isJoinMember: false,
          joinGroup: null,
        },
      });
    }
  }

  // Create edges
  const edges: Edge<TransitionEdgeData>[] = [];
  for (const [from, to] of Object.entries(edgeMap)) {
    if (typeof to === "string") {
      if (to === "end") continue;
      const outputSchema = cellDefs[from]?.schema;
      const outputKeys = outputSchema?.output ? Object.keys(outputSchema.output) : [];
      edges.push({
        id: `${from}->${to}`,
        source: from,
        target: to,
        type: "transitionEdge",
        data: { label: "", keys: outputKeys },
      });
    } else if (typeof to === "object" && to !== null) {
      for (const [transition, target] of Object.entries(to as Record<string, string>)) {
        if (target === "end") continue;
        const outputSchema = cellDefs[from]?.schema;
        const branchOutput = outputSchema?.output?.[transition];
        const outputKeys = branchOutput && typeof branchOutput === "object"
          ? Object.keys(branchOutput as Record<string, unknown>)
          : [];
        edges.push({
          id: `${from}->${target}[${transition}]`,
          source: from,
          target,
          type: "transitionEdge",
          label: transition,
          data: { label: transition, keys: outputKeys },
        });
      }
    }
  }

  return applyDagreLayout(nodes, edges);
}

function applyDagreLayout(
  nodes: Node<CellNodeData>[],
  edges: Edge<TransitionEdgeData>[],
): { nodes: Node<CellNodeData>[]; edges: Edge<TransitionEdgeData>[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutNodes, edges };
}

export function schemaOutputSummary(schema: Record<string, unknown> | null): string {
  if (!schema) return "";
  const output = schema.output as Record<string, unknown> | undefined;
  return summarizeSchema(output);
}

export function schemaInputSummary(schema: Record<string, unknown> | null): string {
  if (!schema) return "";
  const input = schema.input as Record<string, unknown> | undefined;
  return summarizeSchema(input);
}
