import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScanLine, PackageX, CalendarClock } from "lucide-react";
import { useStoresForFigure } from "../../hooks/useStores.js";
import { buildBuyUrl } from "../../lib/storeLink.js";
import { displayTags } from "../../lib/tags.js";
import { relativeAgo, absoluteTime, olderThan } from "../../lib/relativeTime.js";
import { appLocale } from "../../lib/locale.js";
import { STOCK_LABEL, StockGlyph } from "../../components/StockBadge.jsx";
import Button from "../../components/Button.jsx";
import TagRail from "../../components/TagRail.jsx";
import LinkedStoresModal from "../../components/LinkedStoresModal.jsx";

/**
 * #boutiques — the market-facing cartouche blocks re-placed into one section:
 *   店 Boutiques (the inline buy-list + the LinkedStoresModal "voir tout")
 *   市 Marché    (MSRP, JAN + the barcode trigger, NSFW / source flags)
 *   札 Tags      (appearance chips)
 *
 * Lifted out of the old FigureCartouche (the Production block now lives in
 * #identite). Two-column grid on desktop: stores on the left, marché + tags
 * stacked on the right. Blocks with no content drop entirely.
 */
export default function BoutiquesSection({ f, t, onShowBarcode }) {
  const linkedStores = useStoresForFigure(f.id);
  const stores = linkedStores.data ?? [];
  const [storesOpen, setStoresOpen] = useState(false);

  const market = [f.msrp_amount, f.jan, f.is_nsfw, f.is_user_submitted].some(Boolean);
  const appearanceTags = useMemo(() => displayTags(f.visual_tags, { max: 40 }), [f.visual_tags]);

  if (stores.length === 0 && !market && appearanceTags.length === 0) return null;

  return (
    <div className="fig-shops-grid">
      <div className="min-w-0">
        {stores.length > 0 ? (
          <div className="fig-cartouche-block">
            <Heading kanji="店" label={t("figure.cartouche.stores")} />
            <StoreBuyList stores={stores} t={t} />
            <button
              type="button"
              onClick={() => setStoresOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("figure.stores.see_all", { default: "Voir toutes les boutiques" })}
              <span aria-hidden>→</span>
            </button>
          </div>
        ) : null}
        <LinkedStoresModal open={storesOpen} stores={stores} onClose={() => setStoresOpen(false)} />
      </div>

      <div className="min-w-0 space-y-6">
        {market ? (
          <div className="fig-cartouche-block">
            <Heading kanji="市" label={t("figure.cartouche.market")} />
            <dl>
              <Row
                label={t("figure.spec.msrp")}
                value={f.msrp_amount ? `${f.msrp_amount} ${f.msrp_currency ?? ""}`.trim() : null}
              />
              <Row
                label={t("figure.spec.jan")}
                value={f.jan}
                mono
                action={
                  f.jan ? (
                    <button
                      type="button"
                      onClick={onShowBarcode}
                      title={t("figure.spec.jan_scan")}
                      className="tap-target ml-2 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-2.5 py-1 transition-all"
                    >
                      <ScanLine size={13} aria-hidden />
                      {t("figure.cartouche.show_barcode", {
                        default: "Afficher le code-barres",
                      })}
                    </button>
                  ) : null
                }
              />
              {f.is_nsfw ? (
                <Row label={t("figure.spec.nsfw")} value={t("figure.spec.nsfw_yes")} />
              ) : null}
              {f.is_user_submitted ? (
                <Row label={t("figure.spec.source")} value={t("figure.spec.source_user")} />
              ) : null}
            </dl>
          </div>
        ) : null}

        {appearanceTags.length > 0 ? (
          <div className="fig-cartouche-block">
            <Heading kanji="札" label={t("figure.cartouche.tags", { default: "Tags" })} />
            <TagRail
              items={appearanceTags}
              keyOf={(tag) => tag}
              ariaLabel={t("figure.cartouche.tags", { default: "Tags" })}
              renderChip={(tag) => (
                <Link
                  to={`/catalogue?tag=${encodeURIComponent(tag)}`}
                  title={t("figure.cartouche.tag_filter", {
                    default: "Voir les figurines avec ce tag",
                  })}
                  className="inline-flex items-center px-2.5 py-1 text-[12px] capitalize border border-[var(--color-or)]/25 bg-[var(--color-or)]/5 text-[var(--color-ivoire)] hover:border-[var(--color-or)]/60 hover:text-[var(--color-or)] transition-colors"
                >
                  {tag}
                </Link>
              )}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** A cartouche sub-block header — kanji glyph + mono-caps label + filet. */
function Heading({ kanji, label }) {
  return (
    <header className="fig-cartouche-heading">
      <span className="fig-cartouche-heading-kanji" aria-hidden>
        {kanji}
      </span>
      <span className="fig-cartouche-heading-label">{label}</span>
      <span className="fig-cartouche-heading-rule" />
    </header>
  );
}

/** One key/value spec row — optional mono value, link, and trailing action. */
function Row({ label, value, mono = false, href = null, action = null }) {
  return (
    <div className="fig-spec">
      <span className="fig-spec-key">{label}</span>
      <span className={`fig-spec-value ${mono ? "mono" : ""}`}>
        {value ? (
          <>
            {href ? <Link to={href}>{value}</Link> : value}
            {action ? <> {action}</> : null}
          </>
        ) : (
          <span className="fig-spec-empty">—</span>
        )}
      </span>
    </div>
  );
}

// Per-shop stock → buy-control shape. The primary CTA is already laque-red, so
// out-of-stock is DEMOTED to a quiet "Voir" plus an explicit icon+text status
// line (state carried by text/icon, never by button colour alone — WCAG 1.4.1).
// unknown/null falls through to the unchanged primary "Acheter" (no claim).
// Inline sub-label colour per state (CSS-var tones for the figure-detail row;
// the shop-card badge uses Badge tones instead — see StockBadge).
const STOCK_TONE = {
  in_stock: "var(--success)",
  out_of_stock: "var(--danger)",
  preorder: "var(--accent)",
};

/** The buy button's per-state variant / label / icon / aria. */
function buyControl(status, t, name) {
  if (status === "out_of_stock") {
    return {
      variant: "ghost",
      label: t("figure.stores.stock_view"),
      ariaLabel: t("figure.stores.stock_view_at", { name }),
      iconStart: <PackageX size={13} aria-hidden />,
      className: "",
    };
  }
  if (status === "preorder") {
    return {
      variant: "ghost",
      label: t("figure.stores.stock_preorder"),
      ariaLabel: t("figure.stores.stock_preorder_at", { name }),
      iconStart: <CalendarClock size={13} aria-hidden />,
      className: "!text-[var(--accent)] !border-[var(--accent)]/45 hover:!border-[var(--accent)]",
    };
  }
  // in_stock | unknown | null → unchanged primary "Acheter"
  return {
    variant: "primary",
    label: t("figure.stores.buy"),
    ariaLabel: t("figure.stores.buy_at", { name }),
    iconStart: (
      <span aria-hidden className="ja">
        購
      </span>
    ),
    className: "",
  };
}

/** Inline "Acheter chez" buy-list — lifted verbatim from FigureCartouche. */
function StoreBuyList({ stores, t }) {
  return (
    <ul className="flex flex-col gap-2">
      {stores.map((s) => {
        const buyHref = buildBuyUrl(s.url, s.link);
        const status = s.stock_status; // in_stock | out_of_stock | preorder | null
        // Only the DEMOTED states get an explanatory sub-label + freshness. Per
        // spec, in_stock (and unknown) keep the plain "Acheter" with no extra
        // chrome — the buy button already implies availability.
        const demoted = status === "out_of_stock" || status === "preorder";
        const ctl = buyControl(status, t, s.name);
        return (
          <li
            key={s.id}
            className="flex items-center gap-3 px-3 py-2.5 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40 hover:border-[var(--color-or)]/40 hover:bg-[var(--color-or)]/5 transition-colors"
          >
            <Link
              to={`/catalogue/stores/${s.slug}`}
              className="flex items-center gap-3 min-w-0 flex-1 group"
            >
              <span
                aria-hidden
                className="shrink-0 w-9 h-9 grid place-items-center overflow-hidden border border-[var(--color-or)]/25 bg-[color-mix(in_oklab,var(--color-or)_10%,transparent)]"
              >
                {s.image_storage_key ? (
                  <img
                    src={`/api/store-image/${s.id}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="ja text-[var(--color-or)] text-sm">店</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[var(--color-ivoire)] group-hover:text-[var(--color-or-pale)] transition-colors">
                  {s.name}
                </span>
                {s.url ? (
                  <span className="block truncate text-[10px] font-mono tracking-wide text-[var(--color-ivoire-soft)]/55">
                    ↗ {hostnameOf(s.url)}
                  </span>
                ) : null}
                {demoted ? (
                  <span
                    className="mt-0.5 flex w-fit items-center gap-1 text-[10px] uppercase tracking-[0.16em]"
                    style={{ color: STOCK_TONE[status] }}
                  >
                    <StockGlyph status={status} />
                    {t(STOCK_LABEL[status])}
                  </span>
                ) : null}
                {demoted && s.stock_checked_at ? (
                  <span
                    className="block mt-0.5 leading-tight text-[9px] text-[var(--color-ivoire-soft)]/45"
                    title={absoluteTime(s.stock_checked_at, appLocale())}
                  >
                    <span className="tabular-nums">
                      {t("figure.stores.stock_checked", {
                        ago: relativeAgo(s.stock_checked_at, t),
                      })}
                    </span>
                    {olderThan(s.stock_checked_at) ? ` · ${t("figure.stores.stock_stale")}` : ""}
                  </span>
                ) : null}
              </span>
            </Link>
            {buyHref ? (
              <Button
                as="a"
                variant={ctl.variant}
                size="sm"
                href={buyHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={ctl.ariaLabel}
                className={`tap-target shrink-0 gap-1.5 px-3 text-[10px] uppercase tracking-[0.2em] ${ctl.className}`}
                iconStart={ctl.iconStart}
                iconEnd={<span aria-hidden>↗</span>}
              >
                {ctl.label}
              </Button>
            ) : (
              <Link
                to={`/catalogue/stores/${s.slug}`}
                aria-hidden
                tabIndex={-1}
                className="shrink-0 text-[var(--color-or-pale)]/60"
              >
                →
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
