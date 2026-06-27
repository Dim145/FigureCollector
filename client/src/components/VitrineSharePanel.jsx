import { useState } from "react";
import { Share2 } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import Button from "./Button.jsx";
import { useCabinetShare } from "../hooks/useCollection.js";

const MAGENTA = "var(--color-neon-magenta)";

/**
 * Owner-facing "share this cabinet" panel — mints/kills the public
 * `/v/<token>` link for ONE display cabinet and copies it. Mirrors
 * GiftSharePanel (same primitives + Direction-A treatment), but scoped to a
 * single cabinet: the live token rides on the cabinet row (`share_token`), so
 * this is a controlled panel driven by the parent's data.
 *
 * Read-only public view: the link shows the cabinet's pieces, no edit, no
 * reservation. NSFW / value gating is enforced server-side from the owner's
 * public-profile switches.
 */
export default function VitrineSharePanel({ cabinetId, name, shareToken, onClose }) {
  const t = useT();
  const share = useCabinetShare();
  const [copied, setCopied] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const enabled = !!shareToken;
  const url = shareToken ? `${window.location.origin}/v/${shareToken}` : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked (no HTTPS / permission) — the field is selectable */
    }
  };

  const turnOn = () => share.mutate({ id: cabinetId, enabled: true });
  const turnOff = () =>
    share.mutate(
      { id: cabinetId, enabled: false },
      { onSuccess: () => setConfirmOff(false) },
    );

  return (
    <section
      className="mt-3 p-4 bg-[var(--color-noir-soft)]"
      style={{ border: `1px solid color-mix(in oklab, ${MAGENTA} 30%, transparent)` }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="micro" style={{ color: MAGENTA }}>
            <Share2 size={13} strokeWidth={1.75} aria-hidden className="inline-block align-text-bottom mr-1" />
            棚 · {t("vshare.eyebrow")}
          </p>
          <p className="mt-1.5 text-[12px] text-[var(--color-ivoire-soft)] max-w-md leading-relaxed">
            {t("vshare.body", { name })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!enabled ? (
            <button
              type="button"
              onClick={turnOn}
              disabled={share.isPending}
              className="px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivoire)] disabled:opacity-60 transition-opacity"
              style={{ background: MAGENTA }}
            >
              {share.isPending ? "…" : t("vshare.enable")}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 grid place-items-center text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)] transition-colors"
              aria-label={t("editor.cancel")}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {enabled ? (
        <>
          <div
            className="mt-3 flex items-center gap-2 bg-[var(--color-noir)] px-3 py-2"
            style={{ border: `1px solid color-mix(in oklab, ${MAGENTA} 35%, transparent)` }}
          >
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              aria-label={t("vshare.link_label")}
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

          <p className="mt-2.5 text-[11px] text-[var(--color-ivoire-soft)] leading-relaxed">
            {t("vshare.readonly_note")}
          </p>

          <div className="mt-3">
            {confirmOff ? (
              <span className="inline-flex items-center gap-2 text-[12px]">
                <span className="text-[var(--color-ivoire-soft)]">{t("vshare.disable_confirm")}</span>
                <Button variant="danger" size="sm" onClick={turnOff} loading={share.isPending}>
                  {t("vshare.disable")}
                </Button>
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
                {t("vshare.disable")}
              </button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
