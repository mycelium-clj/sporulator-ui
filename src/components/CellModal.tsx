import { useEffect, useState, useCallback } from "react";
import { getCell, saveCell, formatCode, getTestContract, runCellTests } from "../lib/api";
import type { Cell, CellProgress } from "../types";
import type { CellNodeData } from "../lib/graph";
import { ClojureEditor } from "./ClojureEditor";

interface CellModalProps {
  stepName: string;
  cellId: string;
  nodeData: CellNodeData;
  progress: CellProgress | null;
  onClose: () => void;
  onRegenerate: (brief: Record<string, unknown>) => void;
  onCellSaved: () => void;
  onApproveTests?: (cellId: string) => void;
  onRejectTests?: (cellId: string, feedback: string) => void;
  onSaveTests?: (cellId: string, testCode: string) => void;
  onApproveImpl?: (cellId: string) => void;
  onRejectImpl?: (cellId: string, feedback: string) => void;
  onSaveImpl?: (cellId: string, source: string) => void;
}

type TabId = "code" | "tests" | "schema";

export function CellModal({
  stepName, cellId, nodeData, progress, onClose,
  onRegenerate, onCellSaved,
  onApproveTests, onRejectTests, onSaveTests,
  onApproveImpl, onRejectImpl, onSaveImpl,
}: CellModalProps) {
  const [cell, setCell] = useState<Cell | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("schema");
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [editedTests, setEditedTests] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [formattedHandler, setFormattedHandler] = useState<string>("");
  const [formattedTests, setFormattedTests] = useState<string>("");
  const [storedTestCode, setStoredTestCode] = useState<string>("");
  const [runningTests, setRunningTests] = useState(false);
  const [testResult, setTestResult] = useState<{ passed: boolean; output: string; summary?: { test: number; pass: number; fail: number; error: number } } | null>(null);

  const handler = cell?.Handler || "";
  const implSource = progress?.implSource || formattedHandler || handler;
  const testCode = formattedTests || progress?.testCode || storedTestCode || "";
  const hasCodeEdits = editedCode !== null && editedCode !== implSource;
  const hasTestEdits = editedTests !== null && editedTests !== testCode;

  const status = progress?.status;
  const isTestReady = status === "test_ready";
  const isImplReady = status === "impl_ready";
  const isActive = status === "implementing" || status === "testing" || status === "fixing" || status === "test_generating";

  // Auto-switch tabs based on status
  useEffect(() => {
    if (isTestReady) setActiveTab("tests");
    else if (isImplReady) setActiveTab("code");
  }, [isTestReady, isImplReady]);

  // Load cell, tests, and format code
  useEffect(() => {
    setLoading(true);
    setEditedCode(null);
    setEditedTests(null);
    setSaveMsg(null);
    setFormattedHandler("");
    setFormattedTests("");
    setStoredTestCode("");
    setTestResult(null);

    // Load cell
    getCell(cellId)
      .then((c) => {
        setCell(c);
        if (c.Handler && c.Handler !== "") {
          setActiveTab("code");
          formatCode(c.Handler)
            .then((r) => setFormattedHandler(r.formatted))
            .catch(() => setFormattedHandler(c.Handler));
        }
      })
      .catch(() => setCell(null))
      .finally(() => setLoading(false));

    // Load test contract from store (for cells from previous runs)
    getTestContract(cellId)
      .then((tc) => {
        if (tc.TestCode) {
          formatCode(tc.TestCode)
            .then((r) => setStoredTestCode(r.formatted))
            .catch(() => setStoredTestCode(tc.TestCode));
        }
      })
      .catch(() => {}); // No tests in store — that's ok
  }, [cellId]);

  // Format test code when it arrives from progress
  useEffect(() => {
    if (progress?.testCode && progress.testCode !== formattedTests) {
      formatCode(progress.testCode)
        .then((r) => setFormattedTests(r.formatted))
        .catch(() => setFormattedTests(progress.testCode || ""));
    }
  }, [progress?.testCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Format impl source when it arrives from progress
  useEffect(() => {
    if (progress?.implSource) {
      formatCode(progress.implSource)
        .then((r) => {
          // Only update if user hasn't edited
          setFormattedHandler((prev) => prev === "" || prev === handler ? r.formatted : prev);
        })
        .catch(() => {});
    }
  }, [progress?.implSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh cell data when done
  useEffect(() => {
    if (status === "done" || status === "implemented") {
      getCell(cellId)
        .then((c) => {
          setCell(c);
          setEditedCode(null);
          setSaveMsg(null);
          if (c.Handler) {
            formatCode(c.Handler)
              .then((r) => setFormattedHandler(r.formatted))
              .catch(() => setFormattedHandler(c.Handler));
          }
        })
        .catch(() => {});
    }
  }, [status, cellId]);

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleRunTests = useCallback(async () => {
    const code = editedCode ?? implSource;
    const tests = editedTests ?? testCode;
    if (!code || !tests) return;
    setRunningTests(true);
    setTestResult(null);
    try {
      const result = await runCellTests(code, tests);
      setTestResult({ passed: result.passed, output: result.output, summary: result.summary });
    } catch (err) {
      setTestResult({ passed: false, output: err instanceof Error ? err.message : "Failed to run tests" });
    } finally {
      setRunningTests(false);
    }
  }, [editedCode, implSource, editedTests, testCode]);

  const handleSaveCode = useCallback(async () => {
    if (!editedCode || !cell) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const result = await saveCell({ id: cell.ID, handler: editedCode, schema: cell.Schema, doc: cell.Doc, requires: cell.Requires });
      setCell((prev) => prev ? { ...prev, Handler: editedCode, Version: result.Version } : prev);
      setFormattedHandler(editedCode);
      setEditedCode(null);
      setSaveMsg(`Saved (v${result.Version})`);
      onCellSaved();
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (err) {
      setSaveMsg(`Error: ${err instanceof Error ? err.message : "save failed"}`);
    } finally { setSaving(false); }
  }, [editedCode, cell, onCellSaved]);

  const handleRegenerate = useCallback(() => {
    onRegenerate({
      id: cellId,
      doc: cell?.Doc || nodeData.doc || "",
      schema: cell?.Schema || "",
      requires: nodeData.requires || [],
    });
  }, [cell, cellId, nodeData, onRegenerate]);

  // Chat: send feedback to agent based on current tab/status
  const handleChatSend = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatInput("");

    if (activeTab === "tests" && (isTestReady || status === "test_approved")) {
      onRejectTests?.(cellId, msg);
    } else if (activeTab === "code") {
      if (isImplReady) {
        onRejectImpl?.(cellId, msg);
      } else {
        // For cells already implemented, use regenerate with context
        onRegenerate({
          id: cellId,
          doc: (cell?.Doc || nodeData.doc || "") + "\n\nAdditional instructions: " + msg,
          schema: cell?.Schema || "",
          requires: nodeData.requires || [],
        });
      }
    }
  }, [chatInput, activeTab, isTestReady, isImplReady, status, cellId, onRejectTests, onRejectImpl, onRegenerate, cell, nodeData]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  }, [handleChatSend]);

  // Derive display values
  const doc = cell?.Doc || nodeData.doc || "";
  const requires = cell
    ? (cell.Requires && cell.Requires !== "" && cell.Requires !== "[]" ? cell.Requires : "")
    : (nodeData.requires.length > 0 ? `[${nodeData.requires.map(r => `:${r}`).join(" ")}]` : "");
  const schemaStr = cell?.Schema && cell.Schema !== ""
    ? cell.Schema
    : nodeData.schema ? formatSchemaObj(nodeData.schema) : "";

  const testsBadge = isTestReady;
  const codeBadge = isImplReady;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={handleBackdrop}>
      <div className="bg-bg-panel border border-border rounded-xl shadow-2xl w-[780px] max-w-[90vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
          <div>
            <h2 className="text-text-bright text-base font-medium">{stepName}</h2>
            <span className="text-xs text-accent font-mono">{cellId}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleRegenerate} disabled={isActive}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-text hover:text-text-bright hover:border-accent/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {isActive ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Working…
                </span>
              ) : "Regenerate"}
            </button>
            <button onClick={onClose} className="text-text hover:text-text-bright transition-colors p-1">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        </div>

        {/* Progress banner */}
        {isActive && (
          <div className="px-5 py-2 border-b border-border bg-violet-500/5 flex items-center gap-2 shrink-0">
            <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-violet-400 font-medium">
              {status === "test_generating" && "Generating tests..."}
              {status === "implementing" && "Implementing..."}
              {status === "testing" && "Running tests..."}
              {status === "fixing" && "Fixing issues..."}
              {progress?.attempt != null && progress.attempt > 1 && ` (attempt ${progress.attempt})`}
            </span>
          </div>
        )}
        {status === "failing" && (
          <div className="px-5 py-2 border-b border-border bg-status-red/5 flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-status-red shrink-0" />
            <span className="text-xs text-status-red font-medium">Failed</span>
            {progress?.message && <span className="text-xs text-text/40 truncate ml-1">{progress.message}</span>}
          </div>
        )}
        {(status === "done" || status === "implemented") && (
          <div className="px-5 py-2 border-b border-border bg-status-green/5 flex items-center gap-2 shrink-0">
            <span className="w-2 h-2 rounded-full bg-status-green shrink-0" />
            <span className="text-xs text-status-green font-medium">Complete</span>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border px-5 shrink-0">
          {(["code", "tests", "schema"] as TabId[]).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`relative px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-accent text-accent"
                  : "border-transparent text-text hover:text-text-bright"
              }`}>
              {tab === "code" ? "Handler" : tab === "tests" ? "Tests" : "Schema"}
              {((tab === "tests" && testsBadge) || (tab === "code" && codeBadge)) && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
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
              {doc && <p className="text-sm text-text mb-4">{doc}</p>}

              {/* ── Handler tab ── */}
              {activeTab === "code" && (
                implSource !== "" ? (
                  <>
                    <ClojureEditor value={editedCode ?? implSource} readOnly={false} onChange={setEditedCode} />
                    {/* Test output */}
                    {progress?.testOutput && (
                      <div className="mt-3 bg-bg rounded-lg border border-border p-3 text-xs font-mono text-text/70 max-h-32 overflow-y-auto whitespace-pre">
                        {progress.testOutput}
                      </div>
                    )}
                    {/* Review buttons for impl_ready */}
                    {isImplReady && (
                      <div className="flex items-center gap-2 mt-4">
                        <button onClick={() => { if (hasCodeEdits && editedCode) onSaveImpl?.(cellId, editedCode); else onApproveImpl?.(cellId); }}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-status-green/20 text-status-green hover:bg-status-green/30 transition-colors">
                          {hasCodeEdits ? "Save & Approve" : "Approve"}
                        </button>
                        {hasCodeEdits && (
                          <button onClick={() => setEditedCode(null)}
                            className="px-4 py-1.5 text-xs font-medium rounded-md text-text hover:text-text-bright transition-colors">
                            Discard Changes
                          </button>
                        )}
                      </div>
                    )}
                    {/* Save/Cancel buttons for manual edits (not during review flow) */}
                    {hasCodeEdits && !isImplReady && (
                      <div className="flex items-center gap-2 mt-4">
                        <button onClick={handleSaveCode} disabled={saving}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50">
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditedCode(null)}
                          className="px-4 py-1.5 text-xs font-medium rounded-md text-text hover:text-text-bright transition-colors">
                          Discard Changes
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-bg rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm mb-2">No implementation yet</div>
                    <div className="text-xs text-text/25">Approve tests first, then implementation will be generated</div>
                  </div>
                )
              )}

              {/* ── Tests tab ── */}
              {activeTab === "tests" && (
                testCode !== "" ? (
                  <>
                    <ClojureEditor value={editedTests ?? testCode} readOnly={false} onChange={setEditedTests} />

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      {/* Run Tests button — always visible when there's code + tests */}
                      {implSource && (
                        <button onClick={handleRunTests} disabled={runningTests}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-40">
                          {runningTests ? (
                            <span className="flex items-center gap-1.5">
                              <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                              Running…
                            </span>
                          ) : "Run Tests"}
                        </button>
                      )}
                      {/* Review buttons for test_ready */}
                      {isTestReady && (
                        <>
                          <button onClick={() => { if (hasTestEdits && editedTests) onSaveTests?.(cellId, editedTests); else onApproveTests?.(cellId); }}
                            className="px-4 py-1.5 text-xs font-medium rounded-md bg-status-green/20 text-status-green hover:bg-status-green/30 transition-colors">
                            {hasTestEdits ? "Save & Approve" : "Approve Tests"}
                          </button>
                        </>
                      )}
                      {hasTestEdits && (
                        <button onClick={() => setEditedTests(null)}
                          className="px-4 py-1.5 text-xs font-medium rounded-md text-text hover:text-text-bright transition-colors">
                          Discard Changes
                        </button>
                      )}
                    </div>

                    {/* Test results */}
                    {testResult && (
                      <div className={`mt-3 rounded-lg border p-3 ${testResult.passed ? "border-status-green/30 bg-status-green/5" : "border-status-red/30 bg-status-red/5"}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`w-2 h-2 rounded-full ${testResult.passed ? "bg-status-green" : "bg-status-red"}`} />
                          <span className={`text-xs font-medium ${testResult.passed ? "text-status-green" : "text-status-red"}`}>
                            {testResult.passed ? "All tests passed" : "Tests failed"}
                          </span>
                          {testResult.summary && (
                            <span className="text-xs text-text/40">
                              ({testResult.summary.test} tests, {testResult.summary.pass} passed, {testResult.summary.fail} failed, {testResult.summary.error} errors)
                            </span>
                          )}
                        </div>
                        {testResult.output && (
                          <pre className="text-xs font-mono text-text/70 max-h-40 overflow-y-auto whitespace-pre-wrap">
                            {testResult.output}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Approved badge */}
                    {(status === "test_approved" || status === "implementing" || status === "impl_ready" || status === "done") && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-status-green">
                        <span className="w-2 h-2 rounded-full bg-status-green" />
                        Tests approved
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-bg rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm mb-2">
                      {status === "test_generating" ? "Generating tests..." : "No tests yet"}
                    </div>
                    {status === "test_generating" && (
                      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mt-2" />
                    )}
                  </div>
                )
              )}

              {/* ── Schema tab ── */}
              {activeTab === "schema" && (
                schemaStr !== "" ? (
                  <ClojureEditor value={formatEdnSchema(schemaStr)} readOnly />
                ) : (
                  <div className="bg-bg rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm mb-2">No schema defined</div>
                  </div>
                )
              )}

              {/* Footer: metadata */}
              <div className="flex items-center gap-4 mt-4 text-xs text-text/40">
                {cell && <span>v{cell.Version}</span>}
                {cell?.CreatedBy && <span>by {cell.CreatedBy}</span>}
                {!cell && <span className="text-status-yellow">not yet in store</span>}
                {requires && <span className="font-mono">requires {requires}</span>}
                {saveMsg && (
                  <span className={saveMsg.startsWith("Error") ? "text-status-red" : "text-status-green"}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Chat input ── */}
        {activeTab !== "schema" && (
          <div className="border-t border-border px-5 py-3 shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder={
                  activeTab === "tests"
                    ? "Tell the agent what to change about the tests..."
                    : "Tell the agent what to change about the implementation..."
                }
                className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm text-text-bright placeholder:text-text/30 focus:outline-none focus:border-accent/50"
                disabled={isActive}
              />
              <button
                onClick={handleChatSend}
                disabled={!chatInput.trim() || isActive}
                className="px-4 py-2 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSchemaObj(schema: { input: Record<string, unknown>; output: Record<string, unknown> }): string {
  return `{:input  ${objToEdn(schema.input)}\n :output ${objToEdn(schema.output)}}`;
}

function objToEdn(obj: unknown, depth = 0): string {
  if (obj === null || obj === undefined) return "nil";
  if (typeof obj === "string") return `:${obj}`;
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return `[${obj.map(v => objToEdn(v, depth + 1)).join(" ")}]`;
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const indent = "  ".repeat(depth + 1);
    return `{\n${entries.map(([k, v]) => `${indent}:${k} ${objToEdn(v, depth + 1)}`).join("\n")}\n${"  ".repeat(depth)}}`;
  }
  return String(obj);
}

function formatEdnSchema(raw: string): string {
  if (!raw) return "(no schema)";
  let depth = 0, result = "", inString = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && (i === 0 || raw[i - 1] !== "\\")) { inString = !inString; result += ch; continue; }
    if (inString) { result += ch; continue; }
    if (ch === "{" || ch === "[") { depth++; result += ch + "\n" + "  ".repeat(depth); }
    else if (ch === "}" || ch === "]") { depth--; result += "\n" + "  ".repeat(depth) + ch; }
    else if (ch === "," || (ch === " " && i + 1 < raw.length && raw[i + 1] === ":")) { result += "\n" + "  ".repeat(depth); }
    else { result += ch; }
  }
  return result;
}
