import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCell, saveCell, formatCode, getTestContract, runCellTests } from "../lib/api";
import type { Cell, CellProgress } from "../types";
import { ClojureEditor } from "./ClojureEditor";

interface CellPageProps {
  cellProgress: Record<string, CellProgress>;
  onRegenerate: (cellId: string, brief: Record<string, unknown>) => void;
  onCellSaved: () => void;
  onApproveTests?: (cellId: string) => void;
  onRejectTests?: (cellId: string, feedback: string) => void;
  onSaveTests?: (cellId: string, testCode: string) => void;
  onApproveImpl?: (cellId: string) => void;
  onRejectImpl?: (cellId: string, feedback: string) => void;
  onSaveImpl?: (cellId: string, source: string) => void;
}

type TabId = "code" | "tests" | "schema";

export function CellPage({
  cellProgress,
  onRegenerate, onCellSaved,
  onApproveTests, onRejectTests, onSaveTests,
  onApproveImpl, onRejectImpl, onSaveImpl,
}: CellPageProps) {
  const { cellId: rawCellId } = useParams<{ cellId: string }>();
  const navigate = useNavigate();
  const cellId = rawCellId ? decodeURIComponent(rawCellId) : "";

  const [cell, setCell] = useState<Cell | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("schema");
  const [editedCode, setEditedCode] = useState<string | null>(null);
  const [editedTests, setEditedTests] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [formattedHandler, setFormattedHandler] = useState("");
  const [formattedTests, setFormattedTests] = useState("");
  const [storedTestCode, setStoredTestCode] = useState("");
  const [runningTests, setRunningTests] = useState(false);
  const [testResult, setTestResult] = useState<{
    passed: boolean;
    output: string;
    error?: string;
    summary?: { test: number; pass: number; fail: number; error: number };
  } | null>(null);

  const progress = cellProgress[cellId] || null;
  const handler = cell?.Handler || "";
  const implSource = progress?.implSource || formattedHandler || handler;
  const testCode = formattedTests || progress?.testCode || storedTestCode || "";
  const hasCodeEdits = editedCode !== null && editedCode !== implSource;
  const hasTestEdits = editedTests !== null && editedTests !== testCode;

  const status = progress?.status;
  const isTestReady = status === "test_ready";
  const isImplReady = status === "impl_ready";
  const isActive = status === "implementing" || status === "testing" || status === "fixing" || status === "test_generating";

  // Auto-switch tabs
  useEffect(() => {
    if (isTestReady) setActiveTab("tests");
    else if (isImplReady) setActiveTab("code");
  }, [isTestReady, isImplReady]);

  // Load cell + tests
  useEffect(() => {
    if (!cellId) return;
    setLoading(true);
    setEditedCode(null);
    setEditedTests(null);
    setSaveMsg(null);
    setFormattedHandler("");
    setFormattedTests("");
    setStoredTestCode("");
    setTestResult(null);

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

    getTestContract(cellId)
      .then((tc) => {
        if (tc.TestCode) {
          formatCode(tc.TestCode)
            .then((r) => setStoredTestCode(r.formatted))
            .catch(() => setStoredTestCode(tc.TestCode));
        }
      })
      .catch(() => {});
  }, [cellId]);

  // Format incoming progress data
  useEffect(() => {
    if (progress?.testCode) {
      formatCode(progress.testCode)
        .then((r) => setFormattedTests(r.formatted))
        .catch(() => setFormattedTests(progress.testCode || ""));
    }
  }, [progress?.testCode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (progress?.implSource) {
      formatCode(progress.implSource)
        .then((r) => setFormattedHandler((prev) => prev === "" || prev === handler ? r.formatted : prev))
        .catch(() => {});
    }
  }, [progress?.implSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when done
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
  }, [status, cellId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunTests = useCallback(async () => {
    const code = editedCode ?? implSource;
    const tests = editedTests ?? testCode;
    if (!code || !tests) return;
    setRunningTests(true);
    setTestResult(null);
    try {
      const result = await runCellTests(code, tests);
      setTestResult({ passed: result.passed, output: result.output, error: result.error, summary: result.summary });
    } catch (err) {
      setTestResult({ passed: false, output: "", error: err instanceof Error ? err.message : "Failed to run tests" });
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
    onRegenerate(cellId, {
      id: cellId,
      doc: cell?.Doc || "",
      schema: cell?.Schema || "",
      requires: [],
    });
  }, [cell, cellId, onRegenerate]);

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
        onRegenerate(cellId, {
          id: cellId,
          doc: (cell?.Doc || "") + "\n\nAdditional instructions: " + msg,
          schema: cell?.Schema || "",
          requires: [],
        });
      }
    }
  }, [chatInput, activeTab, isTestReady, isImplReady, status, cellId, cell, onRejectTests, onRejectImpl, onRegenerate]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  }, [handleChatSend]);

  const doc = cell?.Doc || "";
  const schemaStr = cell?.Schema || "";
  const requires = cell?.Requires && cell.Requires !== "" && cell.Requires !== "[]" ? cell.Requires : "";

  const testsBadge = isTestReady;
  const codeBadge = isImplReady;

  if (!cellId) return <div className="p-8 text-text">No cell selected</div>;

  return (
    <div className="flex flex-col h-screen bg-bg">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-panel shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-text hover:text-text-bright transition-colors text-sm">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 4L6 8l4 4" />
            </svg>
            Back to Graph
          </button>
          <div className="h-4 w-px bg-border" />
          <div>
            <span className="text-text-bright text-sm font-medium">{cellId.split("/").pop()}</span>
            <span className="text-xs text-accent font-mono ml-2">{cellId}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Status badge */}
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs text-violet-400">
              <span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              {status === "test_generating" ? "Generating tests" : status === "implementing" ? "Implementing" : status === "testing" ? "Running tests" : "Fixing"}
              {progress?.attempt != null && progress.attempt > 1 && ` (attempt ${progress.attempt})`}
            </span>
          )}
          {(status === "done" || status === "implemented") && (
            <span className="flex items-center gap-1.5 text-xs text-status-green">
              <span className="w-2 h-2 rounded-full bg-status-green" />
              Complete
            </span>
          )}
          {status === "failing" && (
            <span className="flex items-center gap-1.5 text-xs text-status-red">
              <span className="w-2 h-2 rounded-full bg-status-red" />
              Failed
            </span>
          )}
          {/* Metadata */}
          <div className="flex items-center gap-3 text-xs text-text/40">
            {cell && <span>v{cell.Version}</span>}
            {cell?.CreatedBy && <span>by {cell.CreatedBy}</span>}
            {requires && <span className="font-mono">requires {requires}</span>}
            {saveMsg && (
              <span className={saveMsg.startsWith("Error") ? "text-status-red" : "text-status-green"}>
                {saveMsg}
              </span>
            )}
          </div>
          <button onClick={handleRegenerate} disabled={isActive}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-text hover:text-text-bright hover:border-accent/50 transition-colors disabled:opacity-40">
            Regenerate
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-text">
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            Loading...
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Main content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Tabs */}
            <div className="flex border-b border-border px-5 shrink-0 bg-bg-panel">
              {(["code", "tests", "schema"] as TabId[]).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`relative px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab
                      ? "border-accent text-accent"
                      : "border-transparent text-text hover:text-text-bright"
                  }`}>
                  {tab === "code" ? "Handler" : tab === "tests" ? "Tests" : "Schema"}
                  {((tab === "tests" && testsBadge) || (tab === "code" && codeBadge)) && (
                    <span className="absolute top-1 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-5">
              {doc && <p className="text-sm text-text mb-4">{doc}</p>}

              {/* ── Handler ── */}
              {activeTab === "code" && (
                implSource ? (
                  <>
                    <ClojureEditor value={editedCode ?? implSource} readOnly={false} onChange={setEditedCode} />
                    {progress?.testOutput && (
                      <div className="mt-3 bg-bg-panel rounded-lg border border-border p-3 text-xs font-mono text-text/70 max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {progress.testOutput}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
                      {isImplReady && (
                        <button onClick={() => { if (hasCodeEdits && editedCode) onSaveImpl?.(cellId, editedCode); else onApproveImpl?.(cellId); }}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-status-green/20 text-status-green hover:bg-status-green/30 transition-colors">
                          {hasCodeEdits ? "Save & Approve" : "Approve"}
                        </button>
                      )}
                      {hasCodeEdits && !isImplReady && (
                        <button onClick={handleSaveCode} disabled={saving}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50">
                          {saving ? "Saving…" : "Save"}
                        </button>
                      )}
                      {hasCodeEdits && (
                        <button onClick={() => setEditedCode(null)}
                          className="px-4 py-1.5 text-xs font-medium rounded-md text-text hover:text-text-bright transition-colors">
                          Discard Changes
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="bg-bg-panel rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm">No implementation yet</div>
                  </div>
                )
              )}

              {/* ── Tests ── */}
              {activeTab === "tests" && (
                testCode ? (
                  <>
                    <ClojureEditor value={editedTests ?? testCode} readOnly={false} onChange={setEditedTests} />
                    <div className="flex items-center gap-2 mt-4 flex-wrap">
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
                      {isTestReady && (
                        <button onClick={() => { if (hasTestEdits && editedTests) onSaveTests?.(cellId, editedTests); else onApproveTests?.(cellId); }}
                          className="px-4 py-1.5 text-xs font-medium rounded-md bg-status-green/20 text-status-green hover:bg-status-green/30 transition-colors">
                          {hasTestEdits ? "Save & Approve" : "Approve Tests"}
                        </button>
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
                        {(testResult.output || testResult.error) && (
                          <pre className="text-xs font-mono text-text/70 max-h-60 overflow-y-auto whitespace-pre-wrap">
                            {testResult.error || testResult.output}
                          </pre>
                        )}
                      </div>
                    )}
                    {(status === "test_approved" || status === "implementing" || status === "impl_ready" || status === "done") && (
                      <div className="mt-3 flex items-center gap-1.5 text-xs text-status-green">
                        <span className="w-2 h-2 rounded-full bg-status-green" />
                        Tests approved
                      </div>
                    )}
                  </>
                ) : (
                  <div className="bg-bg-panel rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm">
                      {status === "test_generating" ? "Generating tests..." : "No tests yet"}
                    </div>
                    {status === "test_generating" && (
                      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mt-2" />
                    )}
                  </div>
                )
              )}

              {/* ── Schema ── */}
              {activeTab === "schema" && (
                schemaStr ? (
                  <ClojureEditor value={schemaStr} readOnly />
                ) : (
                  <div className="bg-bg-panel rounded-lg border border-border/50 p-8 text-center">
                    <div className="text-text/40 text-sm">No schema defined</div>
                  </div>
                )
              )}
            </div>

            {/* Chat input */}
            {activeTab !== "schema" && (
              <div className="border-t border-border px-5 py-3 shrink-0 bg-bg-panel">
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
                  <button onClick={handleChatSend} disabled={!chatInput.trim() || isActive}
                    className="px-4 py-2 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-40">
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
