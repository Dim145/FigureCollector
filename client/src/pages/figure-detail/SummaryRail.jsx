import { Link } from "react-router-dom";
import { Pencil, Share2, Trash2 } from "lucide-react";
import { typeKanji } from "../../lib/typeHue.js";
import { preorderPhase, preorderPhaseFromFigure } from "../../lib/preorderStatus.js";
import AccentTitle from "../../components/AccentTitle.jsx";
import Money from "../../components/Money.jsx";
import MangaLinkBadge from "../../components/MangaLinkBadge.jsx";
import AddToCollectionForm from "../../components/AddToCollectionForm.jsx";
import { OwnerGlance, WishlistCta } from "./OwnerGlancePanel.jsx";

/**
 * Sticky summary rail — the right column of the hero row in ⓪ La Fiche. While
 * the tall gallery on the left scrolls, this short rail stays pinned under the
 * AppShell header (`position: sticky`), keeping the cote + the single primary
 * CTA always in view — the whole point of the redesign (kills the empty-half
 * void of the old spread).
 *
 * Holds ONLY the glanceable essentials, in order:
 *   HeroKicker · lot-stamp + ActionCluster · AccentTitle + version ·
 *   VALUE block (OwnerGlance when owned, else a quiet MSRP / "non possédée"
 *   line) · owned/preorder STATE badge · the ONE primary CTA.
 *
 * No `overflow:hidden` may sit on an ancestor or the sticky breaks — the
 * orchestrator keeps the hero grid clean.
 */
export default function SummaryRail({
  f,
  ownedRecord,
  alreadyOwned,
  canEdit,
  t,
  onEdit,
  onDelete,
  onShare,
  onEditMine,
}) {
  const phase = ownedRecord ? preorderPhase(ownedRecord) : preorderPhaseFromFigure(f);
  const isPreorder = phase === "preorder" || phase === "imminent";

  return (
    <aside className="fig-rail" aria-label={t("figure.rail.aria", { default: "Résumé" })}>
      <div className="fig-rail-card">
        <div className="fig-rail-kicker">
          <HeroKicker f={f} owned={ownedRecord} t={t} />
          <ActionCluster
            canEdit={canEdit}
            onEdit={onEdit}
            onDelete={onDelete}
            onShare={onShare}
            t={t}
          />
        </div>

        <h1
          className={`fig-rail-title ${(f.name?.length ?? 0) > 38 ? "fig-rail-title--long" : ""}`}
        >
          <AccentTitle text={f.name} />
        </h1>
        {f.version_name ? <div className="fig-rail-version">{f.version_name}</div> : null}

        <div className="mt-4">
          <span className="fig-lot">
            <span className="fig-lot-label">{t("figure.lot.eyebrow")}</span>
            <span className="fig-lot-value">
              Nº{" "}
              {String(f.id ?? "")
                .slice(0, 8)
                .toUpperCase()}
            </span>
            <span className="fig-lot-label">{t("figure.lot.kind")}</span>
            <span className="fig-lot-value">{t(`type.${f.figure_type ?? "other"}`)}</span>
          </span>
        </div>

        {/* VALUE block — owned → the read-only glance (acompte + cote +
         *  sparkline). Not owned → a quiet MSRP / "non possédée" line so the
         *  rail is never an empty box. */}
        {ownedRecord ? (
          <OwnerGlance f={f} owned={ownedRecord} t={t} />
        ) : (
          <NotOwnedValue f={f} t={t} />
        )}

        {/* STATE badge — static-looking, text-carrying. */}
        <StateBadge owned={ownedRecord} isPreorder={isPreorder} t={t} />

        {/* MangaCollector synergy — renders only when the series is linked. */}
        <MangaLinkBadge figureId={f.id} />

        {/* The ONE primary CTA. */}
        <div className="fig-rail-cta">
          {alreadyOwned ? (
            <button type="button" onClick={onEditMine} className="wish-cta wish-cta--on">
              <Pencil size={16} aria-hidden />
              {t("figure.edit_mine.cta", { default: "Éditer ma pièce" })}
            </button>
          ) : (
            <>
              <WishlistCta figureId={f.id} t={t} />
              <div className="wish-or">{t("wishlist.or")}</div>
              <AddToCollectionForm
                figureId={f.id}
                catalogMsrp={f.msrp_amount}
                catalogCurrency={f.msrp_currency}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

/** Quiet value line for a piece the viewer doesn't own — shows the catalog
 *  MSRP when known, else a "non possédée" placeholder, so the rail's value
 *  slot is never blank. */
function NotOwnedValue({ f, t }) {
  return (
    <div className="fig-rail-value">
      <span className="fig-rail-value-label">
        {f.msrp_amount != null
          ? t("figure.spec.msrp")
          : t("figure.rail.not_owned", { default: "Non possédée" })}
      </span>
      <span className="fig-rail-value-amount tabular-nums">
        {f.msrp_amount != null ? (
          <Money amount={f.msrp_amount} currency={f.msrp_currency} />
        ) : (
          "—"
        )}
      </span>
    </div>
  );
}

/** Owned / preorder state badge — a seal glyph + a short status line. */
function StateBadge({ owned, isPreorder, t }) {
  if (!owned) return null;
  const sub = [
    owned.condition ? t(`condition.${owned.condition}`) : null,
    isPreorder ? t("figure.kicker.preorder", { default: "PRÉ-COMMANDE" }).toLowerCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="fig-rail-state" role="status">
      <span className="seal ja" aria-hidden>
        私
      </span>
      <span className="txt">
        <span className="t">{t("figure.already_owned")}</span>
        {sub ? <span className="s">{sub}</span> : null}
      </span>
    </div>
  );
}

/** Editorial kicker over the headline — `SÉRIE · 予 · PRÉ-COMMANDE`. Moved here
 *  verbatim from FigureHeroPanel (generic labels, no value duplication). */
function HeroKicker({ f, owned, t }) {
  const phase = owned ? preorderPhase(owned) : preorderPhaseFromFigure(f);
  const isPreorder = phase === "preorder" || phase === "imminent";
  const kanji = isPreorder ? "予" : typeKanji(f.figure_type);
  const trail = isPreorder
    ? t("figure.kicker.preorder", { default: "PRÉ-COMMANDE" })
    : owned
      ? t("figure.kicker.owned", { default: "MA PIÈCE" })
      : t("figure.kicker.piece", { default: "LA PIÈCE" });
  return (
    <p className="micro flex items-center gap-2.5 flex-wrap">
      <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
      {f.series_name ? (
        f.series_slug ? (
          <Link
            to={`/catalogue/series/${f.series_slug}`}
            className="hover:text-[var(--color-or)] transition-colors"
          >
            {t("figure.spec.series")}
          </Link>
        ) : (
          <span>{t("figure.spec.series")}</span>
        )
      ) : (
        <span>{t(`type.${f.figure_type ?? "other"}`)}</span>
      )}
      <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">
        {kanji}
      </span>
      <span>{trail}</span>
    </p>
  );
}

/** Hero action cluster — share always; edit + delete for catalog editors.
 *  Moved here verbatim from FigureHeroPanel. */
function ActionCluster({ canEdit, onEdit, onDelete, onShare, t }) {
  return (
    <div className="fig-actions">
      <button
        type="button"
        onClick={onShare}
        title={t("figure.action.share")}
        aria-label={t("figure.action.share")}
      >
        <Share2 size={16} aria-hidden />
      </button>
      {canEdit ? (
        <>
          <button
            type="button"
            onClick={onEdit}
            title={t("figure.edit.cta")}
            aria-label={t("figure.edit.cta")}
          >
            <Pencil size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="danger"
            title={t("figure.edit.delete")}
            aria-label={t("figure.edit.delete")}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
