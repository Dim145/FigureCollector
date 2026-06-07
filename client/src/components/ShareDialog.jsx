import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import Button from "./Button.jsx";

/**
 * Small "share this figure" popup.
 *
 * The URL is whatever the caller passes — usually the current location. We
 * just provide one-tap copy buttons + a native `navigator.share` fallback
 * on devices that support it. Posting to Twitter / Facebook / etc. would
 * pull us into tracking-script territory and a dozen brand assets we don't
 * want to ship.
 *
 * @param {object} props
 * @param {string} props.url     The URL to share.
 * @param {string} props.title   Figure name, used as the share title.
 * @param {() => void} props.onClose
 */
export default function ShareDialog({ url, title, onClose }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const cardRef = useRef(null);

  // Focus trap: enter the dialog on open, cycle on Tab, Esc closes,
  // focus restores to the trigger button on close.
  useFocusTrap(cardRef, { active: true, onClose });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked; visible URL is the fallback */
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share?.({ title, url });
    } catch {
      /* user cancelled / API unavailable */
    }
  };

  const supportsNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return createPortal(
    <div
      className="fig-pop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      onClick={onClose}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="fig-pop-card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-baseline justify-between gap-3 mb-4">
          <div>
            <p className="micro">{t("share.eyebrow")}</p>
            <h2
              id="share-title"
              className="display text-2xl text-[var(--color-ivoire)] mt-1"
            >
              {t("share.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xl px-2 -mt-1"
          >
            ✕
          </button>
        </header>

        <p className="text-sm text-[var(--color-ivoire-soft)] mb-3 leading-relaxed">
          {t("share.body")}
        </p>

        {/* URL preview + copy */}
        <label className="block">
          <span className="micro block mb-2">{t("share.field.url")}</span>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="flex-1 bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-sm font-mono text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] truncate"
            />
            <button
              type="button"
              onClick={copy}
              className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] border border-[var(--color-or)]/40 text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-all"
            >
              {copied ? "✓ " + t("share.copied") : t("share.copy")}
            </button>
          </div>
        </label>

        <footer className="mt-6 flex items-center justify-end gap-3">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          {supportsNativeShare ? (
            <Button type="button" variant="primary" onClick={nativeShare}>
              {t("share.native")} ↗
            </Button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
