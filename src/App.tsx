import { useCallback, useEffect, useRef, useState } from "react";
import { GraphCanvas } from "./components/GraphCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { StepsPreview } from "./components/StepsPreview";
import { StatusBar } from "./components/StatusBar";
import { RequirementsInput } from "./components/RequirementsInput";
import { CellModal } from "./components/CellModal";
import {
  connectWs, sendWs,
  listManifests, getManifest, listCells,
  exportManifest, getReplProjectPath,
  listSessions, getSession, clearSession,
} from "./lib/api";
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
  const [appState, setAppState] = useState<AppState>("input");
  const [modalCell, setModalCell] = useState<{ step: string; cellId: string; nodeData: CellNodeData } | null>(null);
  const [manifestBody, setManifestBody] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellProgress, setCellProgress] = useState<Record<string, CellProgress>>({});
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
    } else if (msg.type === "orchestrator_event") {
      const evt = msg.payload as Record<string, unknown>;
      const cellId = normCellId(evt.cell_id as string);
      const phase = evt.phase as string | undefined;
      const status = evt.status as string | undefined;
      if (cellId) {
        setCellProgress((prev) => ({
          ...prev,
          [cellId]: {
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
          [cellId]: { status: "implemented", message: "Implementation complete" },
        }));
        refreshCells();
      }
    } else if (msg.type === "orchestrator_complete" || msg.type === "orchestrator_error") {
      const payload = msg.payload as Record<string, unknown>;
      const passed = ((payload.passed || []) as string[]).map(normCellId).filter(Boolean);
      const failed = ((payload.failed || []) as string[]).map(normCellId).filter(Boolean);
      setCellProgress((prev) => {
        const updated = { ...prev };
        for (const id of passed) updated[id] = { status: "implemented", message: "Complete" };
        for (const id of failed) updated[id] = { status: "failing", message: "Failed" };
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

    // Mark all cells as pending
    const progress: Record<string, CellProgress> = {};
    for (const leaf of leaves) {
      progress[leaf.cell_id] = { status: "stub", message: "Waiting for implementation" };
    }
    setCellProgress(progress);

    sendMessage(ws, "orchestrate", {
      session_id: sessionId,
      leaves,
      base_ns: "app",
    });
  }, [manifestBody, ensureWs, sendMessage, sessionId]);

  const handleClearContext = useCallback(() => {
    clearSession(sessionId).catch(() => {});
    setChatMessages([]);
    setStreamContent("");
    setStepsContent("");
  }, [sessionId]);

  const handleNodeClick = useCallback((_stepName: string, cellId: string, nodeData: CellNodeData) => {
    setModalCell({ step: _stepName, cellId, nodeData });
  }, []);

  // Determine what shows in the main area
  const showGraph = appState === "ready" && manifestBody;
  const showSteps = appState === "decomposing";
  const showGenerating = appState === "generating";

  return (
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
              {/* Approve bar — show when no cells are being implemented yet */}
              {Object.keys(cellProgress).length === 0 && (
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
              <GraphCanvas
                manifestBody={manifestBody}
                cells={cells}
                cellProgress={cellProgress}
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

      {modalCell && (
        <CellModal
          stepName={modalCell.step}
          cellId={modalCell.cellId}
          nodeData={modalCell.nodeData}
          progress={cellProgress[modalCell.cellId] || null}
          onClose={() => setModalCell(null)}
        />
      )}
    </div>
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
