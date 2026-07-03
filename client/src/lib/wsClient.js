// Live cross-device sync client.
//
// Connects to /api/ws when the user is authenticated. Each event from the
// server invalidates the relevant TanStack Query keys so the UI refreshes
// automatically. Auto-reconnects with exponential backoff (max 30 s).

const BACKOFF_MAX = 30_000;
const BACKOFF_INITIAL = 800;

export function startLiveSync(queryClient) {
  let socket = null;
  let backoff = BACKOFF_INITIAL;
  let reconnectTimer = null;
  let stopped = false;

  const url = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/api/ws`;
  };

  const connect = () => {
    if (stopped) return;

    // Neutralise the previous socket's handlers before we reassign `socket`,
    // so a late close/error from the old connection can't queue a second
    // reconnect (which would race with this one and multiply the timers).
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    }
    socket = new WebSocket(url());

    socket.onopen = () => {
      backoff = BACKOFF_INITIAL;
    };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleEvent(msg, queryClient);
      } catch {
        /* not JSON, ignore */
      }
    };

    socket.onclose = () => {
      if (stopped) return;
      // Re-arm from a clean slate so we never stack overlapping timers.
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(BACKOFF_MAX, Math.floor(backoff * 1.7));
    };

    socket.onerror = () => {
      // close handler will reconnect
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    };
  };

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  };
}

function handleEvent(msg, qc) {
  switch (msg?.type) {
    case "hello":
      return;
    case "resync":
      // Server signalled we missed events; invalidate everything user-scoped.
      qc.invalidateQueries({ queryKey: ["owned"] });
      qc.invalidateQueries({ queryKey: ["preorders"] });
      qc.invalidateQueries({ queryKey: ["photos"] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      return;
    case "owned_item_created":
    case "owned_item_updated":
    case "owned_item_deleted":
      qc.invalidateQueries({ queryKey: ["owned"] });
      qc.invalidateQueries({ queryKey: ["compare"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      return;
    case "owned_item_photos_changed":
      if (msg.owned_id) {
        qc.invalidateQueries({ queryKey: ["photos", msg.owned_id] });
      }
      qc.invalidateQueries({ queryKey: ["owned"] });
      return;
    case "scan_updated":
      // gsplat scan changed state / progress (pushed via the Postgres NOTIFY
      // bridge) — refresh that owned item's scans live.
      if (msg.owned_id) {
        qc.invalidateQueries({ queryKey: ["scans", msg.owned_id] });
      }
      return;
    case "document_parsed":
      // A justificatif's OCR job finished (worker → Postgres NOTIFY bridge) —
      // refresh that item's documents so the parsed suggestion shows up.
      if (msg.owned_id) {
        qc.invalidateQueries({ queryKey: ["documents", msg.owned_id] });
      }
      return;
    case "preorder_created":
    case "preorder_updated":
    case "preorder_deleted":
      qc.invalidateQueries({ queryKey: ["preorders"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
      if (msg.preorder_id) {
        qc.invalidateQueries({ queryKey: ["preorder-history", msg.preorder_id] });
      }
      return;
    case "achievements_unlocked":
      qc.invalidateQueries({ queryKey: ["me", "achievements"] });
      // Surface a soft, non-blocking ceremony for each newly-unlocked code.
      if (Array.isArray(msg.codes)) {
        window.dispatchEvent(
          new CustomEvent("fc:achievements-unlocked", { detail: msg.codes }),
        );
      }
      return;
    case "profile_updated":
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["public-profile"] });
      return;
    case "notification_created":
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Fire a DOM event so any consumer (bell badge, toast surface)
      // can react beyond the React Query cache.
      window.dispatchEvent(
        new CustomEvent("fc:notification-created", {
          detail: { id: msg.id },
        }),
      );
      return;
    default:
      return;
  }
}
