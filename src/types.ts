// Backend API types matching the Go sporulator models

// Backend Go structs have no JSON tags — fields are PascalCase in JSON

export interface Cell {
  ID: string;
  Version: number;
  Schema: string;
  Handler: string;
  Doc: string;
  Requires: string;
  CreatedAt: string;
  CreatedBy: string;
}

export interface Manifest {
  ID: string;
  Version: number;
  Body: string;
  CreatedAt: string;
  CreatedBy: string;
}

export interface ManifestSummary {
  ID: string;
  LatestVersion: number;
  UpdatedAt: string;
}

export interface TestResult {
  ID: number;
  CellID: string;
  CellVersion: number;
  Input: string;
  Expected: string;
  Actual: string;
  Passed: boolean;
  Error: string;
  RunAt: string;
}

export interface ReplStatus {
  connected: boolean;
  host?: string;
  port?: number;
}

// Parsed manifest EDN structures

export interface ManifestCellDef {
  id: string;
  doc: string;
  schema: { input: Record<string, unknown>; output: Record<string, unknown> };
  requires: string[];
  "on-error"?: string | null;
}

export interface ManifestJoin {
  cells: string[];
  strategy: "parallel" | "sequential";
}

export interface ParsedManifest {
  id: string;
  cells: Record<string, ManifestCellDef>;
  edges: Record<string, string | Record<string, string>>;
  dispatches?: Record<string, unknown>;
  joins?: Record<string, ManifestJoin>;
  pipeline?: string[];
}

// Cell status based on implementation/test state
export type CellStatus =
  | "implemented"
  | "stub"
  | "failing"
  | "no-schema"
  | "implementing"
  | "testing"
  | "fixing";

// Per-cell progress info from orchestrator_event messages
export interface CellProgress {
  status: CellStatus;
  message: string;
  attempt?: number;
}

// WebSocket message types
export interface WsMessage {
  type: string;
  [key: string]: unknown;
}
