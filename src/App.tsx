import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { GraphCanvas } from "./components/GraphCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { StepsPreview } from "./components/StepsPreview";
import { StatusBar } from "./components/StatusBar";
import { RequirementsInput } from "./components/RequirementsInput";
import { CellPage } from "./components/CellPage";
import {
  connectWs, sendWs,
  listManifests, getManifest, listCells,
  exportManifest, getReplProjectPath,
  listSessions, getSession, clearSession,
  getResources,
} from "./lib/api";
import type { ResourcesResponse } from "./lib/api";
import { extractManifestEdn, parseManifestEdn } from "./lib/edn";
import type { AppState, Cell, CellProgress, ChatMessage, StreamPhase, WsMessage } from "./types";
import type { CellNodeData } from "./lib/graph";

const SESSION_ID_KEY = "sporulator:sessionId";

/** Normalize cell ID: strip leading colon so ":order/validate" → "order/validate" */
function normCellId(id: string | null | undefined): string {
  if (!id) return "";
  return id.startsWith(":") ? id.slice(1) : id;
}

function getOrCreateSessionId(): string {
  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_ID_KEY, id);
  return id;
}

function App() {
  const navigate = useNavigate();
  const [appState, setAppState] = useState<AppState>("input");
  const [manifestBody, setManifestBody] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellProgress, setCellProgress] = useState<Record<string, CellProgress>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourcesResponse | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [streamContent, setStreamContent] = useState("");
  const [stepsContent, setStepsContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [, setStreamPhase] = useState<StreamPhase>(null);
  const [sessionId] = useState(getOrCreateSessionId);
  const projectPathRef = useRef("");
  const manifestBodyRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsHandlerRef = useRef<(msg: WsMessage) => void>(() => {});

  const persistManifest = useCallback((body: string) => {
    if (!projectPathRef.current) return;
    exportManifest(projectPathRef.current, { body }).catch(() => {});
  }, []);

  const refreshCells = useCallback(() => {
    listCells()
      .then((cellList) => setCells(cellList as Cell[]))
      .catch(() => {});
  }, []);

  // On mount: restore state from backend
  useEffect(() => {
    async function init() {
      getReplProjectPath()
        .then(({ path }) => { if (path) projectPathRef.current = path; })
        .catch(() => {});

      getResources()
        .then(setResources)
        .catch(() => {});

      // Try to restore manifest from store
      try {
        const manifests = await listManifests();
        if (manifests.length > 0) {
          const manifest = await getManifest(manifests[0].ID);
          const cellList = await listCells();
          setManifestBody(manifest.Body);
          setCells(cellList as Cell[]);

          // Restore chat history
          try {
            const sessions = await listSessions();
            const mySession = sessions.find(s => s.ID === sessionId) || sessions[0];
            if (mySession) {
              const { messages } = await getSession(mySession.ID);
              if (messages.length > 0) {
                setChatMessages(messages.map(m => ({
                  role: m.Role as "user" | "assistant",
                  content: m.Content,
                })));
              }
            }
          } catch { /* no sessions */ }

          setAppState("ready");
          return;
        }
      } catch { /* backend not available */ }

      setAppState("input");
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  manifestBodyRef.current = manifestBody;

  // WebSocket message handler
  wsHandlerRef.current = (msg: WsMessage) => {
    if (msg.type === "stream_chunk" && msg.id === sessionId) {
      const payload = msg.payload as { chunk: string; phase?: string };
      const phase = payload.phase as StreamPhase;

      if (phase === "decompose") {
        setStepsContent((prev) => prev + payload.chunk);
        setStreamPhase("decompose");
      } else if (phase === "manifest") {
        setStreamContent((prev) => prev + payload.chunk);
        setStreamPhase("manifest");
        if (appState !== "generating") setAppState("generating");
      } else {
        // Follow-up (no phase) — regular graph_chat response
        setStreamContent((prev) => prev + payload.chunk);
      }
    } else if (msg.type === "decompose_end" && msg.id === sessionId) {
      // Decomposition complete — pause for user review
      const content = (msg.payload as { content: string }).content;
      setStepsContent(content);
      setStreaming(false);
      setStreamPhase(null);
      setAppState("decomposing");
      setChatMessages((prev) => [...prev, { role: "assistant", content }]);
    } else if (msg.type === "stream_end" && msg.id === sessionId) {
      const payload = msg.payload as { content: string; steps?: string };
      setStreaming(false);
      setStreamPhase(null);

      const content = payload.content;
      setStreamContent(content);
      setChatMessages((prev) => [...prev, { role: "assistant", content }]);

      const ednBody = extractManifestEdn(content);
      if (ednBody) {
        setManifestBody(ednBody);
        persistManifest(ednBody);
        refreshCells();
        setAppState("ready");
      }
    } else if (msg.type === "stream_error" && (!msg.id || msg.id === sessionId)) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg.payload}` }]);
      setStreaming(false);
      setStreamPhase(null);
    } else if (msg.type === "error") {
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg.payload}` }]);
      setStreaming(false);
    } else if (msg.type === "orchestration_started") {
      const payload = msg.payload as Record<string, unknown>;
      setRunId((payload.run_id as string) || null);
    } else if (msg.type === "orchestrator_event") {
      const evt = msg.payload as Record<string, unknown>;
      const cellId = normCellId(evt.cell_id as string);
      const phase = evt.phase as string | undefined;
      const status = evt.status as string | undefined;
      if (cellId && phase === "cell_status") {
        // Interactive orchestration: cell_status events carry full state
        setCellProgress((prev) => ({
          ...prev,
          [cellId]: {
            ...prev[cellId],
            status: (status || "stub") as CellProgress["status"],
            message: (evt.message as string) || "",
            attempt: evt.attempt as number | undefined,
            runId: evt.run_id as string | undefined,
            testCode: (evt.test_code as string) ?? prev[cellId]?.testCode,
            testBody: (evt.test_body as string) ?? prev[cellId]?.testBody,
            implSource: (evt.source as string) ?? prev[cellId]?.implSource,
            testOutput: (evt.test_output as string) ?? prev[cellId]?.testOutput,
            testsPassed: evt.tests_passed != null ? (evt.tests_passed as boolean) : prev[cellId]?.testsPassed,
          },
        }));
        if (status === "done") refreshCells();
      } else if (cellId) {
        // Legacy orchestrator events (auto-approve path)
        setCellProgress((prev) => ({
          ...prev,
          [cellId]: {
            ...prev[cellId],
            status: mapOrchestratorStatus(phase, status),
            message: (evt.message as string) || "",
            attempt: evt.attempt as number | undefined,
          },
        }));
      }
    } else if (msg.type === "cell_result") {
      const result = msg.payload as Record<string, unknown>;
      const cellId = normCellId(result.cell_id as string);
      if (cellId) {
        setCellProgress((prev) => ({
          ...prev,
          [cellId]: { ...prev[cellId], status: "implemented", message: "Implementation complete" },
        }));
        refreshCells();
      }
    } else if (msg.type === "orchestrator_complete" || msg.type === "orchestrator_error") {
      const payload = msg.payload as Record<string, unknown>;
      const passed = ((payload.passed || []) as string[]).map(normCellId).filter(Boolean);
      const failed = ((payload.failed || []) as string[]).map(normCellId).filter(Boolean);
      setCellProgress((prev) => {
        const updated = { ...prev };
        for (const id of passed) updated[id] = { ...updated[id], status: "done", message: "Complete" };
        for (const id of failed) updated[id] = { ...updated[id], status: "failing", message: "Failed" };
        return updated;
      });
      refreshCells();
    }
  };

  const ensureWs = useCallback((): WebSocket => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return wsRef.current;
    }
    const ws = connectWs(
      (msg) => wsHandlerRef.current(msg),
      () => { wsRef.current = null; },
    );
    wsRef.current = ws;
    return ws;
  }, []);

  const sendMessage = useCallback((ws: WebSocket, type: string, payload: Record<string, unknown>) => {
    const send = () => sendWs(ws, type, { payload });
    if (ws.readyState === WebSocket.OPEN) send();
    else ws.addEventListener("open", send, { once: true });
  }, []);

  // Step 1: decompose requirements into steps (pauses for review)
  const handleSubmitRequirements = useCallback((requirements: string) => {
    setStreamContent("");
    setStepsContent("");
    setStreaming(true);
    setStreamPhase("decompose");
    setAppState("decomposing");
    setChatMessages((prev) => [...prev, { role: "user", content: requirements }]);

    const ws = ensureWs();
    sendMessage(ws, "graph_decompose", { session_id: sessionId, message: requirements });
  }, [ensureWs, sendMessage, sessionId]);

  // Step 2: approve steps (with optional feedback) → build manifest
  const handleApproveSteps = useCallback((feedback?: string) => {
    setStreamContent("");
    setStreaming(true);
    setStreamPhase("manifest");
    setAppState("generating");
    if (feedback) {
      setChatMessages((prev) => [...prev, { role: "user", content: feedback }]);
    }

    const ws = ensureWs();
    sendMessage(ws, "graph_approve", {
      session_id: sessionId,
      feedback: feedback || "",
    });
  }, [ensureWs, sendMessage, sessionId]);

  // Follow-up: uses graph_chat (single-phase, sends current manifest)
  const handleFollowUp = useCallback((message: string) => {
    setStreamContent("");
    setStreaming(true);
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);

    const ws = ensureWs();
    sendMessage(ws, "graph_chat", {
      session_id: sessionId,
      message,
      manifest: manifestBodyRef.current || "",
    });
  }, [ensureWs, sendMessage, sessionId]);

  // Approve graph → kick off cell implementation via orchestrator
  const handleApproveGraph = useCallback(() => {
    if (!manifestBody) return;
    const ws = ensureWs();

    // Extract cell briefs from the parsed manifest
    const raw = parseManifestEdn(manifestBody) as Record<string, unknown> | null;
    if (!raw?.cells) return;

    const leaves = Object.entries(raw.cells as Record<string, Record<string, unknown>>).map(
      ([stepName, cellDef]) => {
        const schema = cellDef.schema as Record<string, unknown> | null;
        return {
          cell_id: (cellDef.id as string) || stepName,
          step_name: stepName,
          doc: (cellDef.doc as string) || "",
          input_schema: schema?.input ? JSON.stringify(schema.input) : "{}",
          output_schema: schema?.output ? JSON.stringify(schema.output) : "{}",
          requires: (cellDef.requires as string[]) || [],
        };
      }
    );

    // Write manifest to disk on approval
    persistManifest(manifestBody);

    // Mark all cells as test_generating
    const progress: Record<string, CellProgress> = {};
    for (const leaf of leaves) {
      progress[leaf.cell_id] = { status: "test_generating", message: "Generating tests..." };
    }
    setCellProgress(progress);

    sendMessage(ws, "start_orchestration", {
      session_id: sessionId,
      leaves,
      base_ns: "app",
      manifest_id: (raw.id as string) || "",
    });
  }, [manifestBody, ensureWs, sendMessage, sessionId, persistManifest]);

  const handleClearContext = useCallback(() => {
    clearSession(sessionId).catch(() => {});
    setChatMessages([]);
    setStreamContent("");
    setStepsContent("");
  }, [sessionId]);

  const handleNodeClick = useCallback((_stepName: string, cellId: string, _nodeData: CellNodeData) => {
    navigate(`/cell/${encodeURIComponent(cellId)}`);
  }, [navigate]);

  // ── Interactive review callbacks ────────────────────────────
  const handleApproveTests = useCallback((cellId: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "approve_tests", { session_id: sessionId, run_id: runId, cell_id: cellId });
  }, [runId, ensureWs, sendMessage, sessionId]);

  const handleRejectTests = useCallback((cellId: string, feedback: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "reject_tests", { session_id: sessionId, run_id: runId, cell_id: cellId, feedback });
  }, [runId, ensureWs, sendMessage, sessionId]);

  const handleSaveTests = useCallback((cellId: string, testCode: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "save_tests", { session_id: sessionId, run_id: runId, cell_id: cellId, test_code: testCode });
  }, [runId, ensureWs, sendMessage, sessionId]);

  const handleApproveImpl = useCallback((cellId: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "approve_impl", { session_id: sessionId, run_id: runId, cell_id: cellId });
  }, [runId, ensureWs, sendMessage, sessionId]);

  const handleRejectImpl = useCallback((cellId: string, feedback: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "reject_impl", { session_id: sessionId, run_id: runId, cell_id: cellId, feedback });
  }, [runId, ensureWs, sendMessage, sessionId]);

  const handleSaveImpl = useCallback((cellId: string, source: string) => {
    if (!runId) return;
    const ws = ensureWs();
    sendMessage(ws, "save_impl", { session_id: sessionId, run_id: runId, cell_id: cellId, source });
  }, [runId, ensureWs, sendMessage, sessionId]);

  // Determine what shows in the main area
  const showGraph = appState === "ready" && manifestBody;
  const showSteps = appState === "decomposing";
  const showGenerating = appState === "generating";

  const graphPage = (
    <div className="flex flex-col h-screen bg-bg">
      <div className="flex flex-1 overflow-hidden">
        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {appState === "input" && (
            <RequirementsInput onSubmit={handleSubmitRequirements} />
          )}

          {showSteps && (
            <StepsPreview
              content={stepsContent}
              isStreaming={streaming}
              onApprove={handleApproveSteps}
            />
          )}

          {showGenerating && (
            <div className="flex-1 flex flex-col">
              {/* Show steps summary at top */}
              {stepsContent && (
                <div className="border-b border-[var(--color-border)] max-h-48 overflow-auto">
                  <StepsPreview content={stepsContent} isStreaming={false} />
                </div>
              )}
              <div className="flex-1 flex flex-col items-center justify-center text-text px-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span className="text-text-bright">Building manifest...</span>
                </div>
                {streamContent && (
                  <div className="text-xs text-text/50 max-w-lg font-mono whitespace-pre-wrap max-h-64 overflow-auto">
                    {streamContent.slice(-500)}
                  </div>
                )}
              </div>
            </div>
          )}

          {showGraph && (
            <>
              {/* Approve bar — show when no cells are being implemented and not all already done */}
              {Object.keys(cellProgress).length === 0 && !cells.every(c => c.Handler && c.Handler !== "") && (
                <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-[var(--color-bg-panel)] shrink-0">
                  <span className="text-sm text-[var(--color-text)]">
                    Review the workflow graph, then approve to start cell implementation.
                  </span>
                  <button
                    onClick={handleApproveGraph}
                    disabled={streaming}
                    className="px-4 py-2 bg-[var(--color-accent)]/20 text-[var(--color-accent)] rounded-lg text-sm font-medium hover:bg-[var(--color-accent)]/30 disabled:opacity-30 transition-colors whitespace-nowrap ml-4"
                  >
                    Approve &amp; Implement
                  </button>
                </div>
              )}
              {/* Approve All Tests bar — show when any cells have test_ready status */}
              {Object.values(cellProgress).some(p => p.status === "test_ready") && (
                <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-amber-500/5 shrink-0">
                  <span className="text-sm text-amber-400">
                    {Object.values(cellProgress).filter(p => p.status === "test_ready").length} cell(s) have tests ready for review
                  </span>
                  <button
                    onClick={() => {
                      Object.entries(cellProgress).forEach(([cellId, p]) => {
                        if (p.status === "test_ready") handleApproveTests(cellId);
                      });
                    }}
                    className="px-4 py-2 bg-status-green/20 text-status-green rounded-lg text-sm font-medium hover:bg-status-green/30 transition-colors whitespace-nowrap ml-4"
                  >
                    Approve All Tests
                  </button>
                </div>
              )}
              {/* Approve All Implementations bar */}
              {Object.values(cellProgress).some(p => p.status === "impl_ready") && (
                <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between bg-amber-500/5 shrink-0">
                  <span className="text-sm text-amber-400">
                    {Object.values(cellProgress).filter(p => p.status === "impl_ready").length} cell(s) have implementations ready for review
                  </span>
                  <button
                    onClick={() => {
                      Object.entries(cellProgress).forEach(([cellId, p]) => {
                        if (p.status === "impl_ready") handleApproveImpl(cellId);
                      });
                    }}
                    className="px-4 py-2 bg-status-green/20 text-status-green rounded-lg text-sm font-medium hover:bg-status-green/30 transition-colors whitespace-nowrap ml-4"
                  >
                    Approve All Implementations
                  </button>
                </div>
              )}
              <GraphCanvas
                manifestBody={manifestBody}
                cells={cells}
                cellProgress={cellProgress}
                availableResources={resources?.available.map(r => r.resource_key)}
                onNodeClick={handleNodeClick}
              />
            </>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-96 border-l border-border bg-bg-panel shrink-0 flex flex-col">
          {appState !== "input" ? (
            <DetailPanel
              messages={chatMessages}
              streaming={streaming}
              streamContent={
                appState === "decomposing" ? stepsContent
                : appState === "generating" ? streamContent
                : streamContent
              }
              onSendMessage={handleFollowUp}
              onClear={handleClearContext}
            />
          ) : null}
        </div>
      </div>

      <StatusBar />
    </div>
  );

  const cellPage = (
    <CellPage
      cellProgress={cellProgress}
      onRegenerate={(_cellId: string, brief: Record<string, unknown>) => {
        const ws = ensureWs();
        sendMessage(ws, "cell_implement", { session_id: sessionId, brief });
      }}
      onCellSaved={() => refreshCells()}
      onApproveTests={handleApproveTests}
      onRejectTests={handleRejectTests}
      onSaveTests={handleSaveTests}
      onApproveImpl={handleApproveImpl}
      onRejectImpl={handleRejectImpl}
      onSaveImpl={handleSaveImpl}
    />
  );

  return (
    <Routes>
      <Route path="/" element={graphPage} />
      <Route path="/cell/:cellId" element={cellPage} />
    </Routes>
  );
}

function mapOrchestratorStatus(phase?: string, status?: string): CellProgress["status"] {
  if (phase === "cell_implement") {
    switch (status) {
      case "started": case "written": case "lint_fix": case "info": case "contract_ok":
        return "implementing";
      case "fixing": return "fixing";
      case "contract_violation": case "error": return "failing";
      default: return "implementing";
    }
  }
  if (phase === "cell_test") {
    switch (status) {
      case "started": case "written": case "running": return "testing";
      case "passed": return "implemented";
      case "failed": case "error": return "failing";
      default: return "testing";
    }
  }
  return "stub";
}

export default App;
