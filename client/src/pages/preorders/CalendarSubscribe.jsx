import { useState } from "react";
import { useCalendarFeed, useRotateCalendarFeed } from "../../hooks/useCalendar.js";

/**
 * "S'abonner au calendrier" — a quiet, collapsible affordance that hands the
 * user their private iCal feed URL (subscribable in Google / Apple / Outlook).
 * The token is minted lazily (only when the panel opens) and can be rotated to
 * revoke a leaked link. Direction-A: noir card, gold hairline, no glow.
 */
export default function CalendarSubscribe({ t }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const feed = useCalendarFeed({ enabled: open });
  const rotate = useRotateCalendarFeed();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const host = typeof window !== "undefined" ? window.location.host : "";
  const path = feed.data?.feed_path ?? "";
  const httpUrl = path ? `${origin}${path}` : "";
  const webcalUrl = path ? `webcal://${host}${path}` : "";

  const copy = async () => {
    if (!httpUrl) return;
    try {
      await navigator.clipboard.writeText(httpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the field is still selectable as a fallback */
    }
  };

  const onRotate = () => {
    if (confirmRotate) {
      rotate.mutate();
      setConfirmRotate(false);
      setCopied(false);
    } else {
      setConfirmRotate(true);
      setTimeout(() => setConfirmRotate(false), 4000);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 min-h-[44px] px-2 text-[11px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
      >
        <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm">
          暦
        </span>
        {t("preorders.ical.cta", { default: "S'abonner au calendrier" })}
        <span aria-hidden className="text-[var(--color-ivoire-soft)]/40">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className="reveal mt-4 w-full max-w-xl bg-[var(--color-noir)]/55 border border-[var(--color-or)]/20 px-5 py-5">
          <p className="text-[13px] leading-relaxed text-[var(--color-ivoire-soft)]/75 mb-4">
            {t("preorders.ical.note", {
              default:
                "Ajoute tes dates de sortie à ton agenda (Google, Apple, Outlook…). Ce lien est privé — ne le partage pas.",
            })}
          </p>

          {feed.isError ? (
            <p className="text-[13px] text-[var(--color-laque-bright)]">
              {t("preorders.ical.error", { default: "Lien indisponible — réessaie." })}
            </p>
          ) : !feed.data ? (
            <p className="micro text-[var(--color-ivoire-soft)]/55">
              {t("preorders.ical.loading", { default: "Préparation du lien…" })}
            </p>
          ) : (
            <>
              <div className="flex items-stretch gap-2">
                <input
                  readOnly
                  aria-label={t("preorders.ical.cta", { default: "S'abonner au calendrier" })}
                  value={httpUrl}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-[var(--color-noir)] border border-[var(--color-or)]/20 px-3 py-2 text-[12px] font-mono text-[var(--color-ivoire-soft)] outline-none focus:border-[var(--color-or)]/50"
                />
                <button
                  type="button"
                  onClick={copy}
                  className="shrink-0 px-3 min-h-[44px] border border-[var(--color-or)]/30 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 transition-colors"
                >
                  {copied
                    ? t("preorders.ical.copied", { default: "Copié" })
                    : t("preorders.ical.copy", { default: "Copier" })}
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <a
                  href={webcalUrl}
                  className="inline-flex items-center gap-2 min-h-[44px] text-[12px] uppercase tracking-[0.18em] text-[var(--color-jade)] hover:text-[var(--color-or)] transition-colors"
                >
                  <span aria-hidden>↗</span>
                  {t("preorders.ical.add", { default: "Ajouter à mon agenda" })}
                </a>
                <button
                  type="button"
                  onClick={onRotate}
                  disabled={rotate.isPending}
                  className="min-h-[44px] text-[11px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/55 hover:text-[var(--color-laque-bright)] transition-colors disabled:opacity-50"
                >
                  {confirmRotate
                    ? t("preorders.ical.rotate_confirm", { default: "Confirmer ?" })
                    : t("preorders.ical.rotate", { default: "Régénérer le lien" })}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
