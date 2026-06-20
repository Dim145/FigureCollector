import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { useStoresForFigure } from "../../hooks/useStores.js";
import { buildBuyUrl } from "../../lib/storeLink.js";
import { displayTags } from "../../lib/tags.js";
import TagRail from "../../components/TagRail.jsx";
import LinkedStoresModal from "../../components/LinkedStoresModal.jsx";

/**
 * "La fiche" — the catalog cartouche. Every spec NOT already surfaced in the
 * hero, grouped into Production / Boutiques / Marché / Tags sub-blocks. Empty
 * blocks are dropped entirely so no header ever sits over an empty body, and
 * nothing duplicates the hero's headline specs.
 *
 * The JAN/EAN sits in the Marché block as a labelled spec with a clear
 * "Afficher le code-barres" affordance (the orchestrator opens the shared
 * BarcodeDialog when it fires).
 */
export default function FigureCartouche({ f, t, onShowBarcode }) {
  // Stores linked to this figure via the M2M (any owned/preorder by any
  // user, plus admin manual links). Show a button when count > 0.
  const linkedStores = useStoresForFigure(f.id);
  const stores = linkedStores.data ?? [];
  const [storesOpen, setStoresOpen] = useState(false);

  // Decide whether each block has any content; skip empty blocks entirely.
  // version_name is omitted on purpose — it already appears as the italic
  // subtitle right under the giant figure name.
  const production = [
    f.sculptor_name,
    f.materials?.length ? f.materials.join(" · ") : null,
    f.release_date,
    f.height_mm ? `${f.height_mm} mm` : null,
    f.edition,
    f.exclusivity,
  ].some(Boolean);

  const market = [f.msrp_amount, f.jan, f.is_nsfw, f.is_user_submitted].some(Boolean);

  // Appearance tags (WD-Tagger), generic ones dropped — clickable chips that
  // open the catalogue filtered on that tag. Memoised so the rail's
  // measurement effect only re-runs when the tag set actually changes.
  const appearanceTags = useMemo(() => displayTags(f.visual_tags, { max: 40 }), [f.visual_tags]);

  if (!production && !market && stores.length === 0 && appearanceTags.length === 0) return null;

  return (
    <div className="fig-cartouche">
      {production ? (
        <div className="fig-cartouche-block">
          <CartoucheHeading kanji="作" label={t("figure.cartouche.production")} />
          <dl>
            <Row label={t("figure.spec.sculptor")} value={f.sculptor_name} />
            <Row
              label={t("figure.spec.materials")}
              value={f.materials?.length ? f.materials.join(" · ") : null}
            />
            <Row label={t("figure.spec.release")} value={f.release_date} />
            <Row label={t("figure.spec.height")} value={f.height_mm ? `${f.height_mm} mm` : null} />
            <Row label={t("figure.spec.edition")} value={f.edition} />
            <Row label={t("figure.spec.exclusivity")} value={f.exclusivity} />
          </dl>
        </div>
      ) : null}

      {stores.length > 0 ? (
        <div className="fig-cartouche-block">
          <CartoucheHeading kanji="店" label={t("figure.cartouche.stores")} />
          <StoreBuyList stores={stores} t={t} />
          {/* The full modal stays reachable for the storefront-level view
           *  (slug, image, deep links) — the inline list is the quick buy
           *  surface, the modal is the complete index. */}
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

      {market ? (
        <div className="fig-cartouche-block">
          <CartoucheHeading kanji="市" label={t("figure.cartouche.market")} />
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
          <CartoucheHeading kanji="札" label={t("figure.cartouche.tags", { default: "Tags" })} />
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
  );
}

/** A cartouche sub-block header — kanji glyph + mono-caps label + filet. */
function CartoucheHeading({ kanji, label }) {
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

/** Inline "Acheter chez" buy-list. Each row is a store-image/initials chip +
 *  name (→ storefront) + a hanko-red "Acheter" action when a product buy-link
 *  is known. Same data as the LinkedStoresModal (kept reachable via "voir
 *  tout"); this is the at-a-glance shopping surface. */
function StoreBuyList({ stores, t }) {
  return (
    <ul className="flex flex-col gap-2">
      {stores.map((s) => {
        const buyHref = buildBuyUrl(s.url, s.link);
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
              </span>
            </Link>
            {buyHref ? (
              <a
                href={buyHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("figure.stores.buy_at", { name: s.name })}
                className="tap-target shrink-0 inline-flex items-center gap-1.5 px-3 text-[10px] uppercase tracking-[0.2em] text-[var(--color-ivoire)] bg-[var(--color-laque)] hover:bg-[var(--color-laque-bright)] transition-colors"
              >
                <span aria-hidden className="ja">
                  購
                </span>
                {t("figure.stores.buy")}
                <span aria-hidden>↗</span>
              </a>
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
