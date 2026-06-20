import { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleAlert, TriangleAlert, Info, X } from "lucide-react";

const ToastCtx = createContext(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

const TONES = {
  default: { icon: Info, color: "var(--accent)" },
  success: { icon: CircleCheck, color: "var(--success)" },
  error: { icon: CircleAlert, color: "var(--danger)" },
  warning: { icon: TriangleAlert, color: "var(--warning)" },
  info: { icon: Info, color: "var(--info)" },
};

let idSeq = 0;

/**
 * Toast host. Mount <ToastProvider> once near the app root; call useToast()
 * anywhere: toast.success("Enregistré"), toast.error(msg), or toast({ title,
 * message, tone, duration }). One polite aria-live region (assertive for
 * errors). Toasts dock bottom on mobile, top-right on desktop, and respect the
 * safe-area inset.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((x) => x.id !== id));
    const tm = timers.current.get(id);
    if (tm) {
      clearTimeout(tm);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (opts) => {
      const o = typeof opts === "string" ? { message: opts } : opts || {};
      const id = ++idSeq;
      const duration = o.duration ?? 4000;
      setToasts((list) => [...list, { id, tone: "default", ...o }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toast,
      dismiss,
      success: (message, o) => toast({ ...o, message, tone: "success" }),
      error: (message, o) => toast({ ...o, message, tone: "error" }),
      info: (message, o) => toast({ ...o, message, tone: "info" }),
      warning: (message, o) => toast({ ...o, message, tone: "warning" }),
    }),
    [toast, dismiss],
  );

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(
        <div
          className="fixed inset-x-0 bottom-0 flex flex-col gap-2 p-4 safe-bottom pointer-events-none sm:inset-x-auto sm:bottom-auto sm:top-0 sm:right-0 sm:items-end"
          style={{ zIndex: "var(--z-toast)" }}
          aria-live="polite"
          aria-atomic="false"
        >
          {toasts.map((t) => {
            const tone = TONES[t.tone] ?? TONES.default;
            const Ic = tone.icon;
            return (
              <div
                key={t.id}
                role={t.tone === "error" ? "alert" : "status"}
                className="fc-anim-pop pointer-events-auto w-full sm:w-80 flex items-start gap-3 bg-[var(--surface)] border border-[var(--border)] px-4 py-3"
                style={{ borderRadius: "var(--radius-md)", boxShadow: "var(--elevation-3)" }}
              >
                <Ic
                  size={18}
                  strokeWidth={1.75}
                  style={{ color: tone.color, flexShrink: 0, marginTop: 2 }}
                />
                <div className="min-w-0 flex-1">
                  {t.title ? (
                    <p className="text-sm font-medium text-[var(--on-surface)]">{t.title}</p>
                  ) : null}
                  {t.message ? (
                    <p className="text-sm text-[var(--on-surface-muted)]">{t.message}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Fermer"
                  className="text-[var(--on-surface-subtle)] hover:text-[var(--on-surface)] transition-colors shrink-0"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
