import { useCallback, useEffect, useRef, useState } from "react";
import { GraphCanvas } from "./components/GraphCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { StatusBar } from "./components/StatusBar";
import { RequirementsInput } from "./components/RequirementsInput";
import { AgentStream } from "./components/AgentStream";
import { CellModal } from "./components/CellModal";
import {
  connectWs, sendWs,
  listManifests, getManifest, listCells,
  exportManifest, getReplProjectPath,
  listSessions, getSession, clearSession,
} from "./lib/api";
import { extractManifestEdn } from "./lib/edn";
import type { Cell, CellProgress, WsMessage } from "./types";
import type { CellNodeData } from "./lib/graph";

type AppState = "loading" | "input" | "generating" | "ready";

const SESSION_ID_KEY = "sporulator:sessionId";

function getOrCreateSessionId(): string {
  const stored = localStorage.getItem(SESSION_ID_KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem(SESSION_ID_KEY, id);
  return id;
}

function App() {
  const [appState, setAppState] = useState<AppState>("loading");
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [modalCell, setModalCell] = useState<{ step: string; cellId: string; nodeData: CellNodeData } | null>(null);
  const [manifestBody, setManifestBody] = useState<string | null>(null);
  const [cells, setCells] = useState<Cell[]>([]);
  const [cellProgress, setCellProgress] = useState<Record<string, CellProgress>>({});
  const [streamContent, setStreamContent] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId] = useState(getOrCreateSessionId);
  const projectPathRef = useRef("");
  const manifestBodyRef = useRef<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsHandlerRef = useRef<(msg: WsMessage) => void>(() => {});

  const persistManifest = useCallback((body: string) => {
    if (!projectPathRef.current) return;
    exportManifest(projectPathRef.current, { body }).catch((err) => {
      console.warn("Failed to export manifest:", err);
    });
  }, []);

  const refreshCells = useCallback(() => {
    listCells()
      .then((cellList) => setCells(cellList as Cell[]))
      .catch(() => {});
  }, []);

  // On mount: restore state from backend
  useEffect(() => {
    async function init() {
      // Infer project path from REPL
      getReplProjectPath()
        .then(({ path }) => { if (path) projectPathRef.current = path; })
        .catch(() => {});

      // Try to restore chat session
      let lastAssistantContent = "";
      try {
        const sessions = await listSessions();
        if (sessions.length > 0) {
          const mySession = sessions.find(s => s.ID === sessionId) || sessions[0];
          const { messages } = await getSession(mySession.ID);

          if (messages.length > 0) {
            if (mySession.ID !== sessionId) {
              localStorage.setItem(SESSION_ID_KEY, mySession.ID);
            }

            const lastAssistant = [...messages].reverse().find(m => m.Role === "assistant");
            if (lastAssistant) {
              lastAssistantContent = lastAssistant.Content;
              setStreamContent(lastAssistantContent);
            }
          }
        }
      } catch {
        // Sessions API not available
      }

      // Load manifest from store
      try {
        const manifests = await listManifests();
        if (manifests.length > 0) {
          const manifest = await getManifest(manifests[0].ID);
          const cellList = await listCells();
          setManifestBody(manifest.Body);
          setCells(cellList as Cell[]);
          setAppState("ready");
          return;
        }
      } catch {
        // Backend not available
      }

      // No manifest in store — try to extract from restored chat
      if (lastAssistantContent) {
        const ednBody = extractManifestEdn(lastAssistantContent);
        if (ednBody) {
          setManifestBody(ednBody);
          setAppState("ready");
          return;
        }
      }

      setAppState("input");
    }

    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep refs in sync with latest state
  manifestBodyRef.current = manifestBody;

  // Keep the handler ref up to date so the WS always dispatches through the latest closure
  wsHandlerRef.current = (msg: WsMessage) => {
    if (msg.type === "stream_chunk" && msg.id === sessionId) {
      const chunk = (msg.payload as { chunk: string }).chunk;
      setStreamContent((prev) => prev + chunk);
    } else if (msg.type === "stream_end" && msg.id === sessionId) {
      const content = (msg.payload as { content: string }).content;
      setStreamContent(content);
      setStreaming(false);
      const ednBody = extractManifestEdn(content);
      if (ednBody) {
        setManifestBody(ednBody);
        persistManifest(ednBody);
        refreshCells();
        setAppState("ready");
      }
    } else if (msg.type === "stream_error" && (!msg.id || msg.id === sessionId)) {
      setStreamContent((prev) => prev + `\n\nError: ${msg.payload}`);
      setStreaming(false);

    } else if (msg.type === "error") {
      setStreamContent((prev) => prev + `\n\nError: ${msg.payload}`);
      setStreaming(false);

    } else if (msg.type === "orchestrator_event") {
      const evt = msg.payload as {
        phase?: string;
        cell_id?: string;
        status?: string;
        message?: string;
        attempt?: number;
      };
      if (evt.cell_id) {
        setCellProgress((prev) => ({
          ...prev,
          [evt.cell_id!]: {
            status: mapOrchestratorStatus(evt.phase, evt.status),
            message: evt.message || "",
            attempt: evt.attempt,
          },
        }));
      }

    } else if (msg.type === "cell_result") {
      const result = msg.payload as { cell_id?: string };
      if (result.cell_id) {
        setCellProgress((prev) => ({
          ...prev,
          [result.cell_id!]: {
            status: "implemented",
            message: "Implementation complete",
          },
        }));
        refreshCells();
      }
    }
  };

  // Stable WS connector — never recreated, dispatches through the ref
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

  const handleSubmitRequirements = useCallback((requirements: string) => {
    setStreamContent("");
    setStreaming(true);
    setAppState("generating");
    const ws = ensureWs();

    const send = () => {
      sendWs(ws, "graph_chat", {
        payload: { session_id: sessionId, message: requirements },
      });
    };

    if (ws.readyState === WebSocket.OPEN) {
      send();
    } else {
      ws.addEventListener("open", send, { once: true });
    }
  }, [ensureWs, sessionId]);

  const handleFollowUp = useCallback((message: string) => {
    setStreamContent("");
    setStreaming(true);
    const ws = ensureWs();

    const send = () => {
      sendWs(ws, "graph_chat", {
        payload: {
          session_id: sessionId,
          message,
          manifest: manifestBodyRef.current || "",
        },
      });
    };

    if (ws.readyState === WebSocket.OPEN) {
      send();
    } else {
      ws.addEventListener("open", send, { once: true });
    }
  }, [ensureWs, sessionId]);

  const handleClearContext = useCallback(() => {
    clearSession(sessionId).catch(() => {});
    setStreamContent("");
  }, [sessionId]);

  const handleNodeClick = useCallback((stepName: string, cellId: string, nodeData: CellNodeData) => {
    setSelectedStep(stepName);
    setSelectedCellId(cellId);
    setModalCell({ step: stepName, cellId, nodeData });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-bg">
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {appState === "loading" && (
            <div className="flex-1 flex items-center justify-center text-text">
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                Connecting...
              </div>
            </div>
          )}

          {appState === "input" && (
            <RequirementsInput onSubmit={handleSubmitRequirements} />
          )}

          {appState === "generating" && (
            <div className="flex-1 flex flex-col items-center justify-center text-text px-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-text-bright">Designing workflow...</span>
              </div>
              <div className="text-xs text-text/50 max-w-md text-center">
                The graph agent is analyzing your requirements and designing the workflow graph
              </div>
            </div>
          )}

          {appState === "ready" && manifestBody && (
            <GraphCanvas
              manifestBody={manifestBody}
              cells={cells}
              cellProgress={cellProgress}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        <div className="w-96 border-l border-border bg-bg-panel shrink-0 flex flex-col">
          {streaming || streamContent ? (
            <AgentStream
              content={streamContent}
              isStreaming={streaming}
              onFollowUp={handleFollowUp}
              onClearContext={handleClearContext}
            />
          ) : appState === "ready" ? (
            <DetailPanel
              selectedStep={selectedStep}
              selectedCellId={selectedCellId}
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
      case "started":
      case "written":
      case "lint_fix":
      case "info":
        return "implementing";
      case "fixing":
        return "fixing";
      case "contract_ok":
        return "implementing";
      case "contract_violation":
      case "error":
        return "failing";
      default:
        return "implementing";
    }
  }
  if (phase === "cell_test") {
    switch (status) {
      case "started":
      case "written":
      case "running":
        return "testing";
      case "passed":
        return "implemented";
      case "failed":
      case "error":
        return "failing";
      default:
        return "testing";
    }
  }
  return "stub";
}

export default App;
