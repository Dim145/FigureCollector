import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.js";

/** Paginated list of notifications. `unreadOnly` filters server-side. */
export function useNotifications({ unreadOnly = false, limit = 50, offset = 0 } = {}) {
  return useQuery({
    queryKey: ["notifications", "list", { unreadOnly, limit, offset }],
    queryFn: () =>
      api.get(
        `/me/notifications?unread_only=${unreadOnly}&limit=${limit}&offset=${offset}`,
      ),
  });
}

/** Bell badge counts: total + unread. Polled at low frequency in addition
 *  to the WebSocket push because the WS may have been temporarily offline. */
export function useNotificationCounts() {
  return useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: () => api.get("/me/notifications/counts"),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 30 * 1000,
  });
}

/** Mark one as read. Optimistically bumps the counts. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/me/notifications/${id}/read`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Mark everything unread as read. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/me/notifications/read-all", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Delete a notification (removes it from the in-app log entirely). */
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/me/notifications/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

/** Hook the WebSocket "notification_created" event to a refetch — when
 *  the user has a tab open and a new notification lands, the bell badge
 *  updates immediately without waiting for the next poll. */
export function useNotificationRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const onNotif = () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    };
    window.addEventListener("fc:notification-created", onNotif);
    return () => window.removeEventListener("fc:notification-created", onNotif);
  }, [qc]);
}

// =============================================================================
// Channel + routing config
// =============================================================================

/** The user's view of available channels (system-level) + their own
 *  subscriptions. Drives the settings page channel cards. */
export function useChannels() {
  return useQuery({
    queryKey: ["notification-channels", "mine"],
    queryFn: () => api.get("/me/notification-channels"),
  });
}

/** Upsert the user's per-channel subscription (enable + destination). */
export function useUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channel_type, enabled, destination }) =>
      api.patch(`/me/notification-channels/${channel_type}`, {
        enabled,
        destination,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-channels"] });
    },
  });
}

/** Per-event x per-channel routing matrix. */
export function useRoutes() {
  return useQuery({
    queryKey: ["notification-routes"],
    queryFn: () => api.get("/me/notification-routes"),
  });
}

export function useSaveRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates) =>
      api.put("/me/notification-routes", { updates }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notification-routes"] });
    },
  });
}

// =============================================================================
// Admin: system-level channel config
// =============================================================================

export function useAdminChannels() {
  return useQuery({
    queryKey: ["admin", "notification-channels"],
    queryFn: () => api.get("/admin/notification-channels"),
  });
}

export function useAdminUpdateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channel_type, enabled, config }) =>
      api.patch(`/admin/notification-channels/${channel_type}`, {
        enabled,
        config,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "notification-channels"] });
      qc.invalidateQueries({ queryKey: ["notification-channels"] });
    },
  });
}

// =============================================================================
// Web Push subscription flow
// =============================================================================

/** Subscribe the current browser to web push. Asks for permission,
 *  registers with the SW, sends the subscription to the backend.
 *  `vapidPublicKey` comes from the system channel config. */
export async function subscribeToWebPush(vapidPublicKey) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Web Push not supported in this browser");
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    throw new Error("Notification permission denied");
  }
  const reg = await navigator.serviceWorker.ready;
  // Convert base64url public key to a Uint8Array for applicationServerKey.
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const json = sub.toJSON();
  await api.post("/me/web-push/subscribe", {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
  return sub;
}

export async function unsubscribeFromWebPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    try {
      await api.post("/me/web-push/unsubscribe", { endpoint });
    } catch {
      /* ignore — the local unsubscribe already happened */
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
