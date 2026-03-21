import { useEffect, useState } from "react";
import { getReplStatus } from "../lib/api";

export function StatusBar() {
  const [replConnected, setReplConnected] = useState<boolean | null>(null);
  const [replInfo, setReplInfo] = useState("");

  useEffect(() => {
    const check = () => {
      getReplStatus()
        .then((status) => {
          setReplConnected(status.connected);
          if (status.connected && status.host) {
            setReplInfo(`${status.host}:${status.port}`);
          } else {
            setReplInfo("");
          }
        })
        .catch(() => {
          setReplConnected(null);
        });
    };

    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-7 bg-bg-panel border-t border-border flex items-center px-3 gap-4 text-xs shrink-0">
      <div className="flex items-center gap-1.5">
        <span className="text-text/50">sporulator</span>
        {replConnected === null ? (
          <span className="text-text/30">checking...</span>
        ) : replConnected ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-status-green" />
            <span className="text-status-green">nREPL {replInfo}</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-status-gray" />
            <span className="text-text/50">nREPL disconnected</span>
          </>
        )}
      </div>
    </div>
  );
}
