import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { Modal } from "./ui/index.js";
import { buildBuyUrl } from "../lib/storeLink.js";

/**
 * Read-only popup listing the stores currently linked to a figure (the
 * `figure_stores` M2M). Triggered from the figure-detail Cartouche when
 * the linked-stores count is > 0.
 *
 * Each row links to /stores/:slug — clicking dismisses the modal AND
 * navigates so the viewer can see the storefront immediately.
 *
 * Composes the shared <Modal> (portal, focus-trap, Esc, scroll-lock, scrim)
 * so it no longer hand-rolls a portal + scrim + keydown listener + close
 * button. Portaling escapes any `transform`-having ancestor that would
 * otherwise trap `position: fixed` inside the cartouche column.
 */
export default function LinkedStoresModal({ open, stores, onClose }) {
  const t = useT();

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <>
          <span aria-hidden className="ja text-[var(--accent)] text-2xl block mb-2">
            店
          </span>
          {t("figure.stores.modal.title")}
        </>
      }
      description={t("figure.stores.modal.count", { n: stores.length })}
    >
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
                to={`/catalogue/stores/${s.slug}`}
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
                    <span className="linked-stores-url">↗ {hostnameOf(s.url)}</span>
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
                  <span aria-hidden className="ja">
                    購
                  </span>
                  <span>{t("figure.stores.buy")}</span>
                  <span aria-hidden className="linked-stores-buy-arrow">
                    ↗
                  </span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
