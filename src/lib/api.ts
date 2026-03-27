import type { Cell, Manifest, ManifestSummary, ReplStatus, TestResult, WsMessage } from "../types";

const API_BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

// Cells
export const listCells = () => get<Cell[]>("/cells");
export const getCell = (id: string) => get<Cell>(`/cell?id=${encodeURIComponent(id)}`);
export const getCellHistory = (id: string) => get<Cell[]>(`/cell/history?id=${encodeURIComponent(id)}`);
export const getCellTests = (id: string) => get<TestResult[]>(`/cell/tests?id=${encodeURIComponent(id)}`);
export const saveCell = (cell: { id: string; handler: string; schema?: string; doc?: string; requires?: string }) =>
  post<{ ID: string; Version: number }>("/cell", cell);

// Test contracts
export interface TestContract {
  ID: number;
  RunID: string;
  CellID: string;
  TestCode: string;
  TestBody: string;
  ReviewNotes: string;
  Status: string;
  Revision: number;
  Feedback: string;
  ApprovedAt: string;
  CreatedAt: string;
  UpdatedAt: string;
}
export const getTestContract = (cellId: string, runId?: string) =>
  get<TestContract>(`/cell/test-contract?id=${encodeURIComponent(cellId)}${runId ? `&run_id=${encodeURIComponent(runId)}` : ""}`);

// Run tests
export interface TestRunResult {
  status: string;
  passed: boolean;
  summary?: { test: number; pass: number; fail: number; error: number };
  output: string;
  error?: string;
}
export const runCellTests = (handler: string, testCode: string) =>
  post<TestRunResult>("/cell/run-tests", { handler, "test-code": testCode });

// Format
export const formatCode = (code: string) =>
  post<{ formatted: string }>("/format", { code });

// Manifests
export const listManifests = () => get<ManifestSummary[]>("/manifests");
export const getManifest = (id: string) => get<Manifest>(`/manifest?id=${encodeURIComponent(id)}`);

// REPL
export const getReplStatus = () => get<ReplStatus>("/repl/status");
export const getReplProjectPath = () => get<{ path: string }>("/repl/project-path");
export const evalCode = (code: string) => post<{ result: string }>("/repl/eval", { code });

// Chat sessions
export interface ChatSessionSummary {
  ID: string;
  AgentType: string;
  MessageCount: number;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface ChatMessageRecord {
  ID: number;
  SessionID: string;
  Role: string;
  Content: string;
  CreatedAt: string;
}

export const listSessions = () => get<ChatSessionSummary[]>("/sessions");
export const getSession = (id: string) =>
  get<{ session: ChatSessionSummary; messages: ChatMessageRecord[] }>(`/session?id=${encodeURIComponent(id)}`);
export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/session?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /session: ${res.status}`);
}
export async function clearSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/session/clear?id=${encodeURIComponent(id)}`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /session/clear: ${res.status}`);
}

// Manifest export to disk
export const exportManifest = (projectPath: string, opts: { manifestId?: string; body?: string }) =>
  post<{ path: string }>("/manifest/export", {
    project_path: projectPath,
    manifest_id: opts.manifestId,
    body: opts.body,
  });

// WebSocket
export type WsHandler = (msg: WsMessage) => void;

export function connectWs(onMessage: WsHandler, onClose?: () => void): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${window.location.host}/ws`);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as WsMessage;
      onMessage(msg);
    } catch {
      console.warn("Non-JSON ws message:", event.data);
    }
  };

  ws.onerror = () => {
    onMessage({ type: "stream_error", payload: "WebSocket connection failed" });
  };

  ws.onclose = () => {
    onClose?.();
  };

  return ws;
}

export function sendWs(ws: WebSocket, type: string, payload: Record<string, unknown> = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}
