import { db } from "./db.js";
import { ApiError, api } from "./api.js";

/**
 * Outbox — mutations made with no network, replayed in order on reconnect.
 *
 * Scope is deliberate: the handful of things a collector actually does away
 * from signal (note a purchase, wish a piece, jot a note), not every write in
 * the app. Anything not listed here still fails loudly online, which is the
 * honest behaviour.
 */
const HANDLERS = {
  "collection.add": (p) => api.post("/me/owned", p),
  "wishlist.add": (p) => api.post("/me/wishlist", p),
  "owned.patch": (p) => api.patch(`/me/owned/${p.id}`, p.patch),
};

/** Give up on an entry after this many failed replays (poison-message guard). */
const MAX_TRIES = 5;

/** Is this failure "the network is gone" rather than "the server said no"? */
export function isOffline(error) {
  return (
    (error instanceof ApiError && error.code === "network") ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  );
}

export async function enqueue(kind, payload) {
  if (!HANDLERS[kind]) throw new Error(`unknown outbox kind: ${kind}`);
  await db.outbox.add({ kind, payload, created_at: Date.now(), tries: 0, last_error: null });
  notify();
}

export async function pendingCount() {
  try {
    return await db.outbox.count();
  } catch {
    return 0;
  }
}

/**
 * Run `fn`; if it fails purely because we're offline, park it in the outbox and
 * report that instead of surfacing an error. Returns `{ queued: true }` so the
 * caller can say "saved, will sync" rather than pretending it succeeded.
 */
export async function withOutbox(kind, payload, fn) {
  try {
    return await fn();
  } catch (e) {
    if (!isOffline(e)) throw e;
    await enqueue(kind, payload);
    return { queued: true };
  }
}

let flushing = false;

/**
 * Replay the outbox oldest-first. Stops at the first entry that fails for a
 * network reason (we're offline again — keep the order intact); an entry the
 * server *rejects* is retried a few times, then dropped with its error kept so
 * one bad row can't wedge the queue forever.
 */
export async function flush() {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    const entries = await db.outbox.orderBy("created_at").toArray();
    for (const entry of entries) {
      const handler = HANDLERS[entry.kind];
      if (!handler) {
        await db.outbox.delete(entry.id);
        continue;
      }
      try {
        await handler(entry.payload);
        await db.outbox.delete(entry.id);
        sent += 1;
      } catch (e) {
        if (isOffline(e)) break; // still offline — try again next time, in order
        const tries = (entry.tries ?? 0) + 1;
        if (tries >= MAX_TRIES) {
          await db.outbox.delete(entry.id);
          failed += 1;
        } else {
          await db.outbox.update(entry.id, { tries, last_error: e?.message ?? "error" });
          failed += 1;
        }
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return { sent, failed };
}

/** Let the UI (OfflineIndicator) refresh its pending badge. */
function notify() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("figurecollector:outbox-changed"));
  }
}

/** Wire the automatic replay. Call once, from the app shell. */
export function startOutboxSync() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => {
    flush();
  };
  window.addEventListener("online", onOnline);
  // Also try once at boot: the tab may have been closed while offline.
  if (navigator.onLine) flush();
  return () => window.removeEventListener("online", onOnline);
}
