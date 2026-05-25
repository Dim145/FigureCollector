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
    socket = new WebSocket(url());

    socket.addEventListener("open", () => {
      backoff = BACKOFF_INITIAL;
      // console.debug("[live] connected");
    });

    socket.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleEvent(msg, queryClient);
      } catch {
        /* not JSON, ignore */
      }
    });

    socket.addEventListener("close", () => {
      if (stopped) return;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(BACKOFF_MAX, Math.floor(backoff * 1.7));
    });

    socket.addEventListener("error", () => {
      // close handler will reconnect
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
    });
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
      return;
    case "owned_item_created":
    case "owned_item_updated":
    case "owned_item_deleted":
      qc.invalidateQueries({ queryKey: ["owned"] });
      qc.invalidateQueries({ queryKey: ["compare"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      return;
    case "owned_item_photos_changed":
      if (msg.owned_id) {
        qc.invalidateQueries({ queryKey: ["photos", msg.owned_id] });
      }
      qc.invalidateQueries({ queryKey: ["owned"] });
      return;
    case "preorder_created":
    case "preorder_updated":
    case "preorder_deleted":
      qc.invalidateQueries({ queryKey: ["preorders"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
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
