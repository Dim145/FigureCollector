import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { Modal, Button } from "./ui/index.js";

/**
 * Small "share this figure" popup.
 *
 * The URL is whatever the caller passes — usually the current location. We
 * just provide one-tap copy buttons + a native `navigator.share` fallback
 * on devices that support it. Posting to Twitter / Facebook / etc. would
 * pull us into tracking-script territory and a dozen brand assets we don't
 * want to ship.
 *
 * Composes the shared <Modal> (portal, focus-trap, Esc, scroll-lock, scrim)
 * so it no longer hand-rolls a portal + scrim + close button.
 *
 * @param {object} props
 * @param {string} props.url     The URL to share.
 * @param {string} props.title   Figure name, used as the share title.
 * @param {() => void} props.onClose
 */
export default function ShareDialog({ url, title, onClose }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

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

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={
        <>
          <span className="micro block mb-1">{t("share.eyebrow")}</span>
          {t("share.title")}
        </>
      }
      description={t("share.body")}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          {supportsNativeShare ? (
            <Button type="button" variant="primary" onClick={nativeShare}>
              {t("share.native")} ↗
            </Button>
          ) : null}
        </>
      }
    >
      {/* URL preview + copy */}
      <label className="block">
        <span className="micro block mb-2">{t("share.field.url")}</span>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="flex-1 bg-[var(--surface-sunken)] border border-[var(--border)] px-3 py-2 text-sm font-mono text-[var(--on-surface)] outline-none focus:border-[var(--accent)] truncate"
          />
          <button
            type="button"
            onClick={copy}
            className="px-3 py-2 text-[10px] uppercase tracking-[0.22em] border border-[var(--border-strong)] text-[var(--on-surface-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all"
          >
            {copied ? "✓ " + t("share.copied") : t("share.copy")}
          </button>
        </div>
      </label>
    </Modal>
  );
}
