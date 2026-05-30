import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useGiftShare,
  useEnableGiftShare,
  useDisableGiftShare,
} from "../hooks/useGiftList.js";

const MAGENTA = "var(--color-neon-magenta)";

/**
 * Owner-facing "share my gift list" panel (on the Souhaits page). Mints/kills
 * the public `/g/<token>` link and copies it. Reservations are deliberately
 * never shown here — the whole point is the owner can't see who claimed what.
 */
export default function GiftSharePanel() {
  const t = useT();
  const share = useGiftShare();
  const enable = useEnableGiftShare();
  const disable = useDisableGiftShare();
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const token = share.data?.token;
  const enabled = !!share.data?.enabled && !!token;
  const url = token ? `${window.location.origin}/g/${token}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked (no HTTPS / permission) — the field is selectable */
    }
  };

  const turnOff = () => {
    disable.mutate(undefined, { onSuccess: () => setConfirmOff(false) });
  };

  return (
    <section
      className="mb-9 p-5 bg-[var(--color-noir-soft)]"
      style={{ border: `1px solid color-mix(in oklab, ${MAGENTA} 30%, transparent)` }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="micro" style={{ color: MAGENTA }}>
            贈 · {t("gift.eyebrow")}
          </p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("gift.share_title")}
          </h2>
          <p className="mt-1.5 text-[13px] text-[var(--color-ivoire-soft)] max-w-lg leading-relaxed">
            {t("gift.share_body")}
          </p>
        </div>
        {!enabled ? (
          <button
            type="button"
            onClick={() => enable.mutate()}
            disabled={enable.isPending || share.isLoading}
            className="shrink-0 px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivoire)] disabled:opacity-60 transition-opacity"
            style={{ background: MAGENTA }}
          >
            {enable.isPending ? "…" : t("gift.enable")}
          </button>
        ) : null}
      </div>

      {enabled ? (
        <>
          <div
            className="mt-4 flex items-center gap-2 bg-[var(--color-noir)] px-3 py-2"
            style={{ border: `1px solid color-mix(in oklab, ${MAGENTA} 35%, transparent)` }}
          >
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-transparent font-mono text-[12px] text-[var(--color-ivoire)] outline-none"
            />
            <button
              type="button"
              onClick={copy}
              className="shrink-0 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] border border-[color-mix(in_oklab,var(--color-or)_35%,transparent)] text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
            >
              {copied ? t("gift.copied") : t("gift.copy")}
            </button>
          </div>

          <p className="mt-3 text-[12px] text-[var(--color-ivoire-soft)] leading-relaxed">
            🎁 <b className="text-[var(--color-ivoire)]">{t("gift.hidden_title")}</b>{" "}
            {t("gift.hidden_body")}
          </p>

          <div className="mt-3">
            {confirmOff ? (
              <span className="inline-flex items-center gap-2 text-[12px]">
                <span className="text-[var(--color-ivoire-soft)]">{t("gift.disable_confirm")}</span>
                <button
                  type="button"
                  onClick={turnOff}
                  disabled={disable.isPending}
                  className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] bg-[var(--color-laque)] text-[var(--color-ivoire)]"
                >
                  {t("gift.disable")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmOff(false)}
                  className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
                >
                  {t("editor.cancel")}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmOff(true)}
                className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
              >
                {t("gift.disable")}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
