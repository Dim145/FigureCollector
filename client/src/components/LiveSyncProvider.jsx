import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMe } from "../hooks/useMe.js";
import { startLiveSync } from "../lib/wsClient.js";

/**
 * Mounts a single WebSocket subscription when the user is authenticated.
 * Closes + reconnects when the auth state changes.
 */
export default function LiveSyncProvider({ children }) {
  const qc = useQueryClient();
  const me = useMe();
  const authed = me.data?.authenticated;

  useEffect(() => {
    if (!authed) return;
    const stop = startLiveSync(qc);
    return stop;
  }, [authed, qc]);

  return children;
}
