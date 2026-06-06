import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useT } from "../i18n/index.jsx";
import { buildBuyUrl } from "../lib/storeLink.js";

/**
 * Read-only popup listing the stores currently linked to a figure (the
 * `figure_stores` M2M). Triggered from the figure-detail Cartouche when
 * the linked-stores count is > 0.
 *
 * Each row links to /stores/:slug — clicking dismisses the modal AND
 * navigates so the viewer can see the storefront immediately.
 *
 * Portal to document.body so the modal escapes any `transform`-having
 * ancestor that would otherwise trap `position: fixed` inside the
 * cartouche column.
 */
export default function LinkedStoresModal({ open, stores, onClose }) {
  const t = useT();
  const cardRef = useRef(null);
  useFocusTrap(cardRef, { active: open, onClose });

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("figure.stores.modal.title")}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/90 backdrop-blur-sm p-6"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="linked-stores-modal"
      >
        <header className="linked-stores-modal-header">
          <span aria-hidden className="ja text-[var(--color-or)] text-2xl">店</span>
          <h2>{t("figure.stores.modal.title")}</h2>
          <p className="micro-tight">
            {t("figure.stores.modal.count", { n: stores.length })}
          </p>
        </header>

        <ul className="linked-stores-modal-list">
          {stores.map((s) => {
            // The buy link is reassembled from the store's base url + the
            // figure's path/query. When present, a dedicated "Acheter" action
            // sits beside the row; the row itself still navigates to the
            // storefront so both intents stay reachable.
            const buyHref = buildBuyUrl(s.url, s.link);
            return (
              <li key={s.id} className="linked-stores-item">
                <Link
                  to={`/stores/${s.slug}`}
                  onClick={onClose}
                  className="linked-stores-row"
                >
                  <span className="linked-stores-thumb" aria-hidden>
                    {s.image_storage_key ? (
                      <img src={`/api/store-image/${s.id}`} alt="" />
                    ) : (
                      <span className="linked-stores-thumb-fallback">店</span>
                    )}
                  </span>
                  <span className="linked-stores-text">
                    <span className="linked-stores-name">{s.name}</span>
                    <span className="linked-stores-slug">/{s.slug}</span>
                    {s.url ? (
                      <span className="linked-stores-url">
                        ↗ {hostnameOf(s.url)}
                      </span>
                    ) : null}
                  </span>
                  {buyHref ? null : (
                    <span aria-hidden className="linked-stores-arrow">
                      →
                    </span>
                  )}
                </Link>
                {buyHref ? (
                  <a
                    href={buyHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="linked-stores-buy"
                    aria-label={t("figure.stores.buy_at", { name: s.name })}
                  >
                    <span aria-hidden className="ja">購</span>
                    <span>{t("figure.stores.buy")}</span>
                    <span aria-hidden className="linked-stores-buy-arrow">↗</span>
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={onClose}
          className="linked-stores-modal-close"
          aria-label={t("editor.cancel")}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
