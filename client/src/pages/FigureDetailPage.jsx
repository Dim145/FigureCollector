import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigure, useOwnedItems, usePreorderForOwned } from "../hooks/useCollection.js";
import { effectiveValue, paidTotal, fmtMoney } from "../lib/money.js";
import {
  preorderPhase,
  preorderPhaseFromFigure,
} from "../lib/preorderStatus.js";
import { useWishlistItems, useAddWishlistItem, useRemoveWishlistItem } from "../hooks/useWishlist.js";
import TrackingChip from "../components/TrackingChip.jsx";
import { useDeleteFigure } from "../hooks/useAdmin.js";
import { useStoresForFigure } from "../hooks/useStores.js";
import { useScans } from "../hooks/useScans.js";
import { ApiError } from "../lib/api.js";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { buildBuyUrl } from "../lib/storeLink.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import CoverPicker from "../components/CoverPicker.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import FigureHero from "../components/FigureHero.jsx";
import MangaLinkBadge from "../components/MangaLinkBadge.jsx";
import AddToCollectionForm from "../components/AddToCollectionForm.jsx";
import BarcodeDialog from "../components/BarcodeDialog.jsx";
import FigurePhotosSection from "../components/FigurePhotosSection.jsx";
import Foldable from "../components/Foldable.jsx";
import LinkedStoresModal from "../components/LinkedStoresModal.jsx";
import OwnedItemEditor from "../components/OwnedItemEditor.jsx";
import PhotoStrip from "../components/PhotoStrip.jsx";
import DocumentsSection from "../components/DocumentsSection.jsx";
import PreorderHistory from "../components/PreorderHistory.jsx";
import ShareDialog from "../components/ShareDialog.jsx";
import TurntableSection from "../components/TurntableSection.jsx";
import { nsfwBlocked, nsfwClass } from "../lib/nsfw.js";

/**
 * "La fiche d'une pièce" — single-object exhibition page.
 *
 * No tabs — long scroll all the way down (mobile-friendly). The page reads:
 *   I.   Hero: gallery + caption + lot stamp + actions + headline specs +
 *        description + add-to-collection CTA
 *   II.  Cartouche: every spec NOT already shown in the hero, grouped in
 *        two sub-blocks (Production / Marché). No information repeats.
 *   III. Catalog gallery: the shared figure-photos surface.
 *   IV.  (owned only) Ma pièce — vertical stack of owner blocks:
 *          · Mes informations  (OwnedItemEditor)
 *          · Couverture        (CoverPicker)
 *          · Pré-commande      (PreorderHistory, when set)
 *          · Mes photos        (PhotoStrip — opens PhotoEditor fullscreen
 *                               internally when adding/editing a shot)
 *          · Vue 360°          (TurntableSection — opens TurntableWizard
 *                               fullscreen internally when capturing)
 *
 * The photo gallery + 360° viewer sit directly on the page. Only the heavy
 * *interactive* surfaces (PhotoEditor + TurntableWizard) take over the
 * viewport — and they handle that themselves via `fixed inset-0 z-50`.
 */
export default function FigureDetailPage() {
  const { id } = useParams();
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const figure = useFigure(id);
  // Include archived: the figure detail page needs to surface an archived
  // owned_item too so the user can restore it / see the cancellation
  // history. /collection itself filters them out via its own toggle.
  const owned = useOwnedItems({ includeArchived: true });
  const del = useDeleteFigure();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [scanCode, setScanCode] = useState(false);
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState(false);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (figure.isLoading) return <AppShell><LoadingState /></AppShell>;
  if (figure.isError) {
    const notFound =
      figure.error instanceof ApiError && figure.error.status === 404;
    return (
      <AppShell>
        {notFound ? (
          <MissingState t={t} figureId={id} />
        ) : (
          <ErrorState t={t} error={figure.error} onRetry={() => figure.refetch()} />
        )}
      </AppShell>
    );
  }
  if (!figure.data) return <AppShell><LoadingState /></AppShell>;

  const f = figure.data;
  const ownedRecord = owned.data?.find((o) => o.figure_id === f.id);
  const alreadyOwned = !!ownedRecord;
  const canEdit = isAdmin || f.created_by === me.data?.user?.id;
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";

  if (nsfwBlocked(f.is_nsfw, nsfwPref) && !isAdmin && !nsfwAcknowledged) {
    return (
      <AppShell>
        <NsfwInterstitial
          t={t}
          figureId={f.id}
          onAcknowledge={() => setNsfwAcknowledged(true)}
        />
      </AppShell>
    );
  }

  const onDelete = async () => {
    await del.mutateAsync(f.id);
    setConfirming(false);
    navigate("/browse");
  };

  return (
    <AppShell>
      <main className="relative pb-24">
        {/* Editorial breadcrumb — a quiet way back to where most arrivals come
         *  from (the catalogue). Mirrors the mockup's "← Retour" link. */}
        <div className="max-w-7xl mx-auto px-6 pt-8">
          <Link
            to="/browse"
            className="reveal inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
            style={{ "--i": 0 }}
          >
            <span aria-hidden>←</span>
            {t("figure.back", { default: "Catalogue" })}
          </Link>
        </div>

        <HeroSection
          f={f}
          ownedRecord={ownedRecord}
          alreadyOwned={alreadyOwned}
          canEdit={canEdit}
          nsfwPref={nsfwPref}
          t={t}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirming(true)}
          onShare={() => setSharing(true)}
        />

        {/* "La fiche" — catalog data + shared gallery, wrapped in a single
         *  foldable. Defaults OPEN when the viewer doesn't own the piece
         *  (they need to see everything to decide); defaults CLOSED when
         *  they do own it (their own data is the focus then). */}
        <section className="max-w-7xl mx-auto px-6">
          <Foldable
            size="major"
            label={t("figure.section.cartouche")}
            defaultOpen={!alreadyOwned}
          >
            <Cartouche f={f} t={t} onScanJan={() => setScanCode(true)} />
            <div className="mt-12">
              <FigurePhotosSection
                figureId={f.id}
                figureName={f.name}
                canEdit={canEdit}
                uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
                blurImages={f.is_nsfw && nsfwPref === "blur"}
              />
            </div>
          </Foldable>
        </section>

        {/* Owner-only stack — each block is independently foldable */}
        {ownedRecord ? (
          <OwnerStack f={f} owned={ownedRecord} nsfwPref={nsfwPref} t={t} />
        ) : null}

        {/* ─── Modals + fullscreen overlays ─── */}
        {editing ? (
          <FigureEditDialog figure={f} onClose={() => setEditing(false)} />
        ) : null}

        {confirming ? (
          <DeleteConfirm
            name={f.name}
            t={t}
            busy={del.isPending}
            onCancel={() => setConfirming(false)}
            onConfirm={onDelete}
          />
        ) : null}

        {sharing ? (
          <ShareDialog
            url={typeof window !== "undefined" ? window.location.href : ""}
            title={f.name}
            onClose={() => setSharing(false)}
          />
        ) : null}

        {scanCode && f.jan ? (
          <BarcodeDialog
            code={f.jan}
            label={f.name}
            onClose={() => setScanCode(false)}
          />
        ) : null}

      </main>
    </AppShell>
  );
}

// =============================================================================
// HERO
// =============================================================================

function HeroSection({
  f,
  ownedRecord,
  alreadyOwned,
  canEdit,
  nsfwPref,
  t,
  onEdit,
  onDelete,
  onShare,
}) {
  return (
    <section className="relative" style={{ "--hue": typeHue(f.figure_type) }}>
      {/* The product page glows in its figure's TYPE colour — a hero wash
          (type hue + gold) over the global aurora. Theme-aware. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 left-0 right-0 h-[460px] -z-0"
        style={{
          background:
            "radial-gradient(46% 70% at 22% 0%, color-mix(in oklab, var(--hue) 24%, transparent), transparent 68%), radial-gradient(40% 60% at 84% 12%, color-mix(in oklab, var(--color-or) 18%, transparent), transparent 72%)",
          // Fade the wash IN below the sticky header — the radials peak at the
          // box's top edge, which sits inside the header band, so without this
          // mask their hard top edge drew a line straight across the navbar.
          maskImage: "linear-gradient(to bottom, transparent, #000 140px)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 140px)",
        }}
      />
      <span
        aria-hidden
        className="kanji-mark text-[32rem] -top-16 -left-16 hidden md:block opacity-[0.07]"
      >
        {typeKanji(f.figure_type)}
      </span>

      <div className="relative max-w-7xl mx-auto px-6 pt-12 md:pt-16 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-start">
        <FigureHero
          figure={f}
          ownedItemId={ownedRecord?.id ?? null}
          figureTypeKanji={typeKanji(f.figure_type)}
          nsfwBlurClass={nsfwClass(f.is_nsfw, nsfwPref)}
        />

        <div className="relative pt-2 min-w-0">
          {/* `min-w-0` mirrors the FigureHero side — both grid items need
           *  it for the `1.1fr_1fr` track to resolve correctly. Without it
           *  a long unbreakable token in the title would expand THIS
           *  column's min-content past its share and overflow the page. */}
          {/* Editorial kicker — SÉRIE · 漢字 · STATUT. The signature
           *  Direction-A eyebrow over the headline (mockup "Fiche figurine").
           *  Carries the series + a status word (pré-commande / pièce). */}
          <HeroKicker f={f} owned={ownedRecord} t={t} />

          {/* Lot stamp + action cluster — allow wrap on narrow viewports so
           *  neither overflows when both are present. */}
          <div
            className="mt-4 flex flex-wrap items-start justify-between gap-3 reveal"
            style={{ "--i": 1 }}
          >
            <div className="fig-lot">
              <span className="fig-lot-label">{t("figure.lot.eyebrow")}</span>
              <span className="fig-lot-value">
                Nº {String(f.id ?? "").slice(0, 8).toUpperCase()}
              </span>
              <span className="fig-lot-label">{t("figure.lot.kind")}</span>
              <span className="fig-lot-value">
                {t(`type.${f.figure_type ?? "other"}`)}
              </span>
            </div>

            <ActionCluster
              canEdit={canEdit}
              onEdit={onEdit}
              onDelete={onDelete}
              onShare={onShare}
              t={t}
            />
          </div>

          <h1
            className={`fig-title mt-7 reveal ${
              (f.name?.length ?? 0) > 38 ? "fig-title--long" : ""
            }`}
            style={{ "--i": 3 }}
          >
            {f.name}
            {f.version_name ? (
              <span className="fig-title-version">{f.version_name}</span>
            ) : null}
          </h1>

          {/* Title rule carries the figure's type hue (fades to gold). */}
          <div
            className="w-32 my-7 h-px reveal"
            style={{
              "--i": 4,
              background:
                "linear-gradient(90deg, var(--hue), color-mix(in oklab, var(--color-or) 60%, transparent) 70%, transparent)",
            }}
          />

          {f.description ? (
            <>
              <SectionLabel
                accent={t("figure.label.notice", { default: "Notice" })}
                rest={t("figure.label.notice_rest", { default: "DE LA PIÈCE" })}
                delay={5}
              />
              <DescriptionBlock text={f.description} t={t} delay={5} />
            </>
          ) : null}

          {/* Spec grid — échelle / hauteur / fabricant / série, the
           *  mockup's `.specgrid`. */}
          <HeadlineSpecs f={f} t={t} delay={6} />

          {/* Owner-only glance blocks — acompte progress (red→gold) + La Cote
           *  (payé vs valeur + gain), mirroring the mockup's hero. Read-only
           *  summaries; the editable detail lives in the owner stack below.
           *  Each renders only when its data is present. */}
          {ownedRecord ? (
            <OwnerGlance f={f} owned={ownedRecord} t={t} delay={7} />
          ) : null}

          {/* MangaCollector synergy — renders only when the user has linked
           *  their manga library AND this figure's series is in it. Returns
           *  null otherwise, so no empty box / stray margin appears. */}
          <MangaLinkBadge figureId={f.id} />

          <div className="mt-9 reveal" style={{ "--i": 8 }}>
            {alreadyOwned ? (
              <OwnedConfirmation t={t} />
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
      </div>
    </section>
  );
}

function ActionCluster({ canEdit, onEdit, onDelete, onShare, t }) {
  return (
    <div className="fig-actions reveal" style={{ "--i": 2 }}>
      <button
        type="button"
        onClick={onShare}
        title={t("figure.action.share")}
        aria-label={t("figure.action.share")}
      >
        <span className="fig-actions-icon" aria-hidden>↗</span>
      </button>
      {canEdit ? (
        <>
          <button
            type="button"
            onClick={onEdit}
            title={t("figure.edit.cta")}
            aria-label={t("figure.edit.cta")}
          >
            <span className="fig-actions-icon" aria-hidden>✎</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="danger"
            title={t("figure.edit.delete")}
            aria-label={t("figure.edit.delete")}
          >
            <span className="fig-actions-icon" aria-hidden>×</span>
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Editorial kicker over the headline — `SÉRIE · 予約 · PRÉ-COMMANDE`, the
 *  mockup's signature eyebrow. Generic *labels* (not the series value, which
 *  the spec grid carries) so nothing repeats: the leading label is "Série"
 *  (linking to the series when a slug exists) or the type; the kanji is 予
 *  for a (future) pre-order else the type glyph; the trailing word states the
 *  status (pré-commande / ma pièce / la pièce). */
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
    <p
      className="micro reveal flex items-center gap-2.5 flex-wrap"
      style={{ "--i": 0 }}
    >
      <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
      {f.series_name ? (
        f.series_slug ? (
          <Link
            to={`/series/${f.series_slug}`}
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

/** Quiet red-accent section label — a kicker whose leading word is set in the
 *  hanko-red display italic (the AccentTitle move, applied to a label). Used to
 *  give the right column the mockup's sectioned product-page rhythm without
 *  accenting the figure name itself. */
function SectionLabel({ accent, rest, delay = 5 }) {
  return (
    <div
      className="reveal flex items-center gap-3 mb-3"
      style={{ "--i": delay }}
    >
      <p className="text-[11px] uppercase tracking-[0.34em] leading-none">
        <span className="display-italic text-[var(--color-laque-bright)]">
          {accent}
        </span>
        {rest ? (
          <span className="text-[var(--color-or-pale)]">{" "}{rest}</span>
        ) : null}
      </p>
      <span
        aria-hidden
        className="flex-1 h-px"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--color-or) 45%, transparent), transparent)",
        }}
      />
    </div>
  );
}

/** Owner glance — the mockup's two hero blocks: the pré-commande *acompte*
 *  progress (red→gold) and *La Cote* (payé vs valeur + gain). Read-only
 *  summaries derived from the owned record + its linked preorder; the editable
 *  detail lives in the owner stack further down. Renders nothing when neither
 *  block has data, so released-and-unpriced pieces show no empty box. */
function OwnerGlance({ f, owned, t, delay = 7 }) {
  const preorder = usePreorderForOwned(owned.id);
  const po = preorder.data ?? null;

  // Acompte: deposit paid against the total figurine cost. The total is the
  // owned price when known, else the catalog MSRP — the same fallback the
  // editor uses. Only shown when a deposit exists and the order isn't
  // cancelled/received (those are historical, not "in progress").
  const deposit = po?.deposit_amount != null ? Number(po.deposit_amount) : null;
  const totalRaw =
    owned.price_amount != null
      ? Number(owned.price_amount)
      : f.msrp_amount != null
        ? Number(f.msrp_amount)
        : null;
  const depositCurrency =
    owned.price_currency || po?.price_currency || f.msrp_currency || null;
  const phase = preorderPhase(owned);
  const acompteActive =
    deposit != null &&
    deposit > 0 &&
    totalRaw != null &&
    totalRaw > 0 &&
    phase !== "cancelled" &&
    phase !== "received";

  // La Cote: paid total vs effective value (manual value, else MSRP). Mirror
  // lib/money's effectiveValue/paidTotal so the figures match the Cote page.
  const value = effectiveValue({
    value_amount: owned.value_amount,
    value_currency: owned.value_currency,
    price_currency: owned.price_currency,
    msrp_amount: f.msrp_amount,
    msrp_currency: f.msrp_currency,
  });
  const paid = paidTotal(owned);
  // Only compute a gain when both are in the SAME currency (no FX layer).
  const sameCurrency =
    paid && value && (paid.currency || "") === (value.currency || "");
  const gain =
    sameCurrency && paid.amount > 0 ? value.amount - paid.amount : null;
  const gainPct =
    gain != null && paid.amount > 0
      ? Math.round((gain / paid.amount) * 100)
      : null;
  const coteActive = !!(paid || value);

  if (!acompteActive && !coteActive) return null;

  return (
    <div className="mt-8 space-y-4 reveal" style={{ "--i": delay }}>
      {acompteActive ? (
        <AcompteBar
          deposit={deposit}
          total={totalRaw}
          currency={depositCurrency}
          t={t}
        />
      ) : null}
      {coteActive ? (
        <CoteGlance
          paid={paid}
          value={value}
          gain={gain}
          gainPct={gainPct}
          t={t}
        />
      ) : null}
    </div>
  );
}

/** Pré-commande acompte progress — a red→gold bar (paid share of the total),
 *  with "acompte versé" (gold) and "solde restant" (red) figures beneath.
 *  Static gradient fill, no animation — GPU-light. */
function AcompteBar({ deposit, total, currency, t }) {
  const pct = Math.max(0, Math.min(100, Math.round((deposit / total) * 100)));
  const balance = Math.max(0, total - deposit);
  return (
    <section
      aria-label={t("figure.glance.acompte", { default: "Pré-commande · acompte" })}
      className="border border-[var(--color-or)]/20 bg-[var(--color-noir-soft)] p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="micro-tight flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">予</span>
          {t("figure.glance.acompte", { default: "Pré-commande · acompte" })}
        </p>
        <span className="font-mono text-sm text-[var(--color-or)]">{pct} %</span>
      </header>
      <div
        className="mt-3.5 h-2 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: "color-mix(in oklab, var(--color-ivoire) 8%, transparent)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--color-laque-bright), var(--color-or))",
          }}
        />
      </div>
      <div className="mt-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="micro-tight">{t("figure.glance.deposit_paid", { default: "Acompte versé" })}</p>
          <p className="figural text-2xl text-[var(--color-or)] leading-none mt-1.5">
            {fmtMoney(deposit, currency)}
          </p>
        </div>
        <div className="text-right">
          <p className="micro-tight">{t("figure.glance.balance_due", { default: "Solde restant" })}</p>
          <p className="figural text-2xl text-[var(--color-laque-bright)] leading-none mt-1.5">
            {fmtMoney(balance, currency)}
          </p>
        </div>
      </div>
    </section>
  );
}

/** La Cote glance — payé vs valeur actuelle, with the latent gain in jade/red.
 *  Value is gold (money), the loss-or-gain tints with the figure's direction. */
function CoteGlance({ paid, value, gain, gainPct, t }) {
  const up = gain != null && gain >= 0;
  return (
    <section
      aria-label={t("cote.title")}
      className="border border-[var(--color-or)]/20 bg-[var(--color-noir-soft)] p-5"
    >
      <header className="flex items-baseline justify-between gap-3">
        <p className="micro-tight flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">金</span>
          {t("cote.title")} · {t("figure.glance.valuation", { default: "valorisation" })}
        </p>
        {gainPct != null ? (
          <span
            className="font-mono text-sm"
            style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
          >
            {up ? "▲" : "▼"} {gainPct > 0 ? "+" : ""}{gainPct} %
          </span>
        ) : null}
      </header>
      <div className="mt-3.5 flex items-end justify-between gap-4">
        <div>
          <p className="micro-tight">{t("cote.paid_abbr")}</p>
          <p className="figural text-2xl text-[var(--color-ivoire)] leading-none mt-1.5">
            {paid ? fmtMoney(paid.amount, paid.currency) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="micro-tight">{t("figure.glance.current_value", { default: "Valeur actuelle" })}</p>
          <p className="figural text-2xl text-[var(--color-or)] leading-none mt-1.5">
            {value ? fmtMoney(value.amount, value.currency) : "—"}
          </p>
        </div>
      </div>
      {gain != null && gain !== 0 ? (
        <p
          className="mt-3.5 pt-3 border-t border-[var(--color-or)]/12 text-[10px] uppercase tracking-[0.22em]"
          style={{ color: up ? "var(--color-jade)" : "var(--color-laque-bright)" }}
        >
          {up
            ? t("figure.glance.gain", { default: "Plus-value latente" })
            : t("figure.glance.loss", { default: "Moins-value latente" })}{" "}
          <span className="font-mono normal-case tracking-normal">
            {gain > 0 ? "+" : ""}{fmtMoney(gain, value.currency)}
          </span>
        </p>
      ) : null}
    </section>
  );
}

/** Prominent wishlist toggle shown in place of the old buried action-cluster
 *  heart. Rendered only when the piece isn't already owned (owned ≠ wishlist),
 *  so adding to the collection — which clears any wish server-side — simply
 *  removes this control on the next render. */
function WishlistCta({ figureId, t }) {
  const wishlist = useWishlistItems();
  const add = useAddWishlistItem();
  const remove = useRemoveWishlistItem();
  const wished = (wishlist.data ?? []).some((w) => w.figure_id === figureId);
  const busy = add.isPending || remove.isPending;
  return (
    <button
      type="button"
      onClick={() =>
        wished ? remove.mutate(figureId) : add.mutate({ figure_id: figureId })
      }
      disabled={busy}
      aria-pressed={wished}
      className={`wish-cta ${wished ? "wish-cta--on" : "wish-cta--off"}`}
    >
      <span className="wish-cta-heart" aria-hidden>
        {wished ? "♥" : "♡"}
      </span>
      {wished ? t("wishlist.remove") : t("wishlist.add")}
    </button>
  );
}

/** Live carrier-tracking chip for an owned item's linked preorder (if any). */
function OwnedTracking({ ownedId, t }) {
  const preorder = usePreorderForOwned(ownedId);
  const url = preorder.data?.tracking_url;
  if (!url) return null;
  return (
    <div className="mt-4">
      <p className="micro-tight mb-1.5">{t("preorders.tracking.carrier")}</p>
      <TrackingChip url={url} />
    </div>
  );
}

/** Split a scraped description into free prose + a `key: value` spec block.
 *  Many imported descriptions are a story paragraph followed by a dump like
 *  "Type: GK Statue / Height: 16-25cm / Pre-order: 2026/05/18 …". We only
 *  treat it as a spec list when there's a real run of such lines (≥3), so
 *  genuine prose (incl. sentences with a stray colon) is left untouched. */
function parseDescription(text) {
  const raw = text ?? "";
  const specRe = /^([\p{L}][\p{L}\d .()/+&'-]{1,22}):\s*(\S.*?)\s*$/u;
  const prose = [];
  const specs = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(specRe);
    const labelWords = m ? m[1].trim().split(/\s+/).length : 0;
    // A spec row = short label, compact value, value not a full sentence.
    if (m && labelWords <= 4 && m[2].length <= 70 && !/[.!?…]\s*$/.test(m[2])) {
      specs.push([m[1].trim(), m[2].trim()]);
    } else {
      prose.push(trimmed);
    }
  }
  if (specs.length < 3) return { prose: raw, specs: [] };
  return { prose: prose.join("\n"), specs };
}

function DescriptionBlock({ text, t, delay = 5 }) {
  const [expanded, setExpanded] = useState(false);
  const { prose, specs } = useMemo(() => parseDescription(text), [text]);

  const isLong = prose.length > 240;
  const display = !isLong || expanded ? prose : prose.slice(0, 220).trimEnd() + "…";

  return (
    <div className="reveal mb-7" style={{ "--i": delay }}>
      {/* `break-words` + `overflow-wrap: anywhere` keep imported
       *  descriptions sane when they contain bare URLs or other unbreakable
       *  tokens — those would otherwise extend the column's min-content past
       *  its grid track's share. */}
      {prose ? (
        <p className="text-[var(--color-ivoire-soft)] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {display}
        </p>
      ) : null}
      {prose && isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
        >
          {expanded
            ? "− " + t("figure.description.collapse")
            : "+ " + t("figure.description.expand")}
        </button>
      ) : null}

      {/* Spec block parsed out of the scraped dump — a clean key/value grid
          instead of a wall of "Label: value" lines. */}
      {specs.length > 0 ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"
          style={
            prose
              ? {
                  marginTop: "1.25rem",
                  paddingTop: "1.25rem",
                  borderTop:
                    "1px solid color-mix(in oklab, var(--color-or) 18%, transparent)",
                }
              : undefined
          }
        >
          {specs.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="contents">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] py-0.5 whitespace-nowrap">
                {k}
              </dt>
              <dd className="text-[var(--color-ivoire)] py-0.5 break-words [overflow-wrap:anywhere]">
                {/^https?:\/\//.test(v) ? (
                  <a
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] underline underline-offset-2 transition-colors"
                  >
                    {v.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function HeadlineSpecs({ f, t, delay = 6 }) {
  // These four are the ONLY place the rows below appear on the page. The
  // cartouche below intentionally skips them — duplication is the enemy.
  const rows = [
    {
      label: t("figure.spec.manufacturer"),
      value: f.manufacturer_name,
      href: f.manufacturer_slug ? `/manufacturers/${f.manufacturer_slug}` : null,
    },
    {
      label: t("figure.spec.series"),
      value: f.series_name,
      href: f.series_slug ? `/series/${f.series_slug}` : null,
    },
    {
      label: t("figure.spec.character"),
      value: f.character_name,
      href: f.character_slug ? `/characters/${f.character_slug}` : null,
    },
    {
      label: t("figure.spec.scale"),
      value: f.scale,
    },
  ].filter((r) => !!r.value);
  if (rows.length === 0) return null;
  // Bordered 2-col spec grid (the mockup's `.specgrid`): a 1px gold-tinted
  // gap over a noir backing forms the inner hairlines; each cell is a
  // mono-caps label over a display-serif value. Same data + links as before.
  return (
    <dl
      className="grid grid-cols-2 gap-px reveal border border-[var(--color-or)]/15"
      style={{
        "--i": delay,
        background: "color-mix(in oklab, var(--color-or) 12%, transparent)",
      }}
    >
      {rows.map((r) => (
        <div
          key={r.label}
          className="bg-[var(--color-noir-soft)] px-4 py-3.5 min-w-0"
        >
          <dt className="label-mono text-[var(--color-ivoire-soft)]/70">
            {r.label}
          </dt>
          <dd className="display text-base text-[var(--color-ivoire)] mt-1.5 leading-tight truncate">
            {r.href ? (
              <Link
                to={r.href}
                className="hover:text-[var(--color-or-pale)] transition-colors underline decoration-[var(--color-or)]/30 underline-offset-4 hover:decoration-[var(--color-or)]"
              >
                {r.value}
              </Link>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function OwnedConfirmation({ t }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border border-[var(--color-or)]/40 bg-[var(--color-or)]/5">
      <span
        aria-hidden
        className="w-2 h-2 bg-[var(--color-or)] rotate-45"
        style={{ boxShadow: "0 0 10px var(--color-or)" }}
      />
      <p className="micro">{t("figure.already_owned")}</p>
    </div>
  );
}

// =============================================================================
// CARTOUCHE — Production + Marché blocks. NO duplication with hero specs.
// =============================================================================

function Cartouche({ f, t, onScanJan }) {
  // Stores linked to this figure via the M2M (any owned/preorder by any
  // user, plus admin manual links). Show a button when count > 0.
  const linkedStores = useStoresForFigure(f.id);
  const stores = linkedStores.data ?? [];
  const [storesOpen, setStoresOpen] = useState(false);

  // Decide whether each block has any content; skip empty blocks entirely
  // so the page never shows a header with an empty body underneath. The
  // version_name is omitted on purpose — it already appears as the italic
  // subtitle right under the giant figure name, and the brief said "no
  // duplication".
  const production = [
    f.sculptor_name,
    f.materials?.length ? f.materials.join(" · ") : null,
    f.release_date,
    f.height_mm ? `${f.height_mm} mm` : null,
    f.edition,
    f.exclusivity,
  ].some(Boolean);

  const market = [f.msrp_amount, f.jan, f.is_nsfw, f.is_user_submitted].some(Boolean);

  if (!production && !market && stores.length === 0) return null;

  return (
    <div className="fig-cartouche">
      {production ? (
        <div className="fig-cartouche-block">
          <header className="fig-cartouche-heading">
              <span className="fig-cartouche-heading-kanji" aria-hidden>作</span>
              <span className="fig-cartouche-heading-label">
                {t("figure.cartouche.production")}
              </span>
              <span className="fig-cartouche-heading-rule" />
            </header>
            <dl>
              <Row label={t("figure.spec.sculptor")} value={f.sculptor_name} />
              <Row
                label={t("figure.spec.materials")}
                value={f.materials?.length ? f.materials.join(" · ") : null}
              />
              <Row label={t("figure.spec.release")} value={f.release_date} />
              <Row
                label={t("figure.spec.height")}
                value={f.height_mm ? `${f.height_mm} mm` : null}
              />
              <Row label={t("figure.spec.edition")} value={f.edition} />
              <Row label={t("figure.spec.exclusivity")} value={f.exclusivity} />
            </dl>
          </div>
        ) : null}

      {stores.length > 0 ? (
        <div className="fig-cartouche-block">
          <header className="fig-cartouche-heading">
            <span className="fig-cartouche-heading-kanji" aria-hidden>店</span>
            <span className="fig-cartouche-heading-label">
              {t("figure.cartouche.stores")}
            </span>
            <span className="fig-cartouche-heading-rule" />
          </header>
          <StoreBuyList stores={stores} t={t} />
          {/* Keep the full modal reachable for the storefront-level view
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

      <LinkedStoresModal
        open={storesOpen}
        stores={stores}
        onClose={() => setStoresOpen(false)}
      />

      {market ? (
        <div className="fig-cartouche-block">
          <header className="fig-cartouche-heading">
            <span className="fig-cartouche-heading-kanji" aria-hidden>市</span>
            <span className="fig-cartouche-heading-label">
              {t("figure.cartouche.market")}
            </span>
            <span className="fig-cartouche-heading-rule" />
          </header>
          <dl>
            <Row
              label={t("figure.spec.msrp")}
              value={
                f.msrp_amount
                  ? `${f.msrp_amount} ${f.msrp_currency ?? ""}`.trim()
                  : null
              }
            />
            <Row
              label={t("figure.spec.jan")}
              value={f.jan}
              mono
              action={
                f.jan ? (
                  <button
                    type="button"
                    onClick={onScanJan}
                    title={t("figure.spec.jan_scan")}
                    className="ml-2 inline-flex items-center text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-2 py-0.5 transition-all"
                  >
                    ▦ {t("figure.spec.jan_scan_cta")}
                  </button>
                ) : null
              }
            />
            {f.is_nsfw ? (
              <Row label={t("figure.spec.nsfw")} value={t("figure.spec.nsfw_yes")} />
            ) : null}
            {f.is_user_submitted ? (
              <Row
                label={t("figure.spec.source")}
                value={t("figure.spec.source_user")}
              />
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

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

/** Inline "Acheter chez" buy-list — the mockup's `.stores`. Each row is a
 *  store-image/initials chip + name (→ storefront) + a hanko-red "Acheter"
 *  action when a product buy-link is known. Same data as the LinkedStoresModal
 *  (kept reachable via "voir tout"); this is the at-a-glance shopping surface. */
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
              to={`/stores/${s.slug}`}
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
                <span aria-hidden className="ja">購</span>
                {t("figure.stores.buy")}
                <span aria-hidden>↗</span>
              </a>
            ) : (
              <Link
                to={`/stores/${s.slug}`}
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

// =============================================================================
// OWNER STACK — vertical sequence (no tabs). Heavies go behind teaser cards.
// =============================================================================

function OwnerStack({ f, owned, nsfwPref, t }) {
  // Default-expand the scan section below when a 360°/3D view already exists
  // (rather than the empty "+ create a scan" state). Shares useScans' query
  // cache with TurntableSection — no extra request.
  const scans = useScans(owned.id);
  const hasScanView = (scans.data ?? []).some(
    (s) =>
      s.state === "ready" &&
      (s.kind === "turntable" || (s.kind === "gsplat" && s.result_key)),
  );
  return (
    <section className="max-w-7xl mx-auto px-6 mt-16 fig-owner-shell">
      <header className="text-center mb-2">
        <p className="micro inline-flex items-center gap-2.5">
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("figure.owner.eyebrow")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">私</span>
        </p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1.5">
          <AccentTitle text={t("figure.owner.title")} />
        </h2>
        <div className="gold-rule w-20 mx-auto mt-4" />
      </header>

      <Foldable
        size="minor"
        kanji="情"
        label={t("figure.owner.tab.info")}
      >
        <OwnedItemEditor
          owned={owned}
          catalogMsrp={f.msrp_amount}
          catalogCurrency={f.msrp_currency}
        />
      </Foldable>

      <Foldable
        size="minor"
        kanji="扉"
        label={t("figure.owner.tab.cover")}
        defaultOpen={false}
      >
        <CoverPicker owned={owned} />
      </Foldable>

      {/* Pre-order block: only when the figure has a release date (the inner
       *  component renders nothing when no linked preorder exists). */}
      {f.release_date ? (
        <Foldable
          size="minor"
          kanji="予"
          label={t("figure.owner.tab.preorder")}
        >
          <PreorderHistory ownedId={owned.id} />
          <OwnedTracking ownedId={owned.id} t={t} />
        </Foldable>
      ) : null}

      {/* Photo gallery — rendered inline on the page. The internal photo
       *  *editor* (PhotoEditor) and lightbox both render as their own
       *  fullscreen overlays via `fixed inset-0 z-50` when triggered. */}
      <Foldable
        size="minor"
        kanji="影"
        label={t("figure.owner.tab.photos")}
      >
        <PhotoStrip
          ownedId={owned.id}
          figureName={f.name}
          uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
          blurImages={f.is_nsfw && nsfwPref === "blur"}
        />
      </Foldable>

      {/* Proof-of-purchase documents — receipts / invoices / customs slips,
       *  private to the owner. */}
      <Foldable
        size="minor"
        kanji="証"
        label={t("figure.owner.tab.documents")}
        defaultOpen={false}
      >
        <DocumentsSection ownedId={owned.id} />
      </Foldable>

      {/* 360° viewer — rendered inline. The capture wizard (TurntableWizard)
       *  is the only heavy interactive surface; it opens itself fullscreen. */}
      <Foldable
        size="minor"
        kanji="巡"
        label={t("figure.owner.tab.scan")}
        defaultOpen={hasScanView}
      >
        <TurntableSection ownedId={owned.id} />
      </Foldable>
    </section>
  );
}

// =============================================================================
// Misc helpers + states
// =============================================================================

function DeleteConfirm({ name, t, busy, onCancel, onConfirm }) {
  return createPortal(
    <div role="dialog" aria-modal aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-body" onClick={onCancel} className="fig-pop">
      <div onClick={(e) => e.stopPropagation()} className="fig-pop-card">
        <h2 id="delete-confirm-title" className="display text-xl text-[var(--color-ivoire)]">
          {t("figure.edit.confirm_delete.title", { name })}
        </h2>
        <p id="delete-confirm-body" className="mt-3 text-[var(--color-ivoire-soft)]">
          {t("figure.edit.confirm_delete.body")}
        </p>
        <div className="flex items-center gap-3 justify-end mt-6">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t("editor.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={busy}
            className="!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]"
          >
            {t("admin.users.confirm_delete.confirm")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function LoadingState() {
  return <div className="max-w-5xl mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)]">…</div>;
}

function MissingState({ t, figureId }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
      <h1 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("figure.missing.title")}
      </h1>
      <p className="mt-3 text-[var(--color-ivoire-soft)] leading-relaxed">
        {t("figure.missing.body")}
      </p>
      {figureId ? (
        <p className="mt-4 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/60 break-all">
          {figureId}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      <div className="flex flex-col items-stretch gap-3">
        <Link
          to="/browse"
          className="px-5 py-3 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
        <Link
          to="/collection"
          className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("figure.missing.cta_collection")}
        </Link>
      </div>
    </div>
  );
}

function ErrorState({ t, error, onRetry }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-laque-bright)]">!</p>
      <h1 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("error.unknown")}
      </h1>
      {error?.message ? (
        <p className="mt-3 text-sm text-[var(--color-ivoire-soft)] italic break-words">
          {error.message}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
      >
        {t("figure.missing.cta_retry")}
      </button>
    </div>
  );
}

function NsfwInterstitial({ t, figureId, onAcknowledge }) {
  return (
    <main className="relative max-w-xl mx-auto px-6 py-24 text-center">
      <span
        aria-hidden
        className="kanji-mark text-[18rem] -top-12 left-1/2 -translate-x-1/2 select-none"
      >
        禁
      </span>
      <p className="micro relative">{t("nsfw.gate.eyebrow")}</p>
      <h1 className="display text-4xl text-[var(--color-ivoire)] mt-3 relative">
        {t("nsfw.gate.title")}
      </h1>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("nsfw.gate.body")}
      </p>
      {figureId ? (
        <p className="mt-3 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/50 break-all relative">
          {figureId}
        </p>
      ) : null}
      <div className="ornate-rule mx-auto w-32 my-8 relative">
        <span aria-hidden className="ornate-rule__diamond" />
      </div>
      <div className="flex flex-col items-stretch gap-3 relative">
        <button
          type="button"
          onClick={onAcknowledge}
          className="px-5 py-3 bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-laque-bright)] transition-colors"
        >
          {t("nsfw.gate.cta_show")}
        </button>
        <Link
          to="/settings"
          className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("nsfw.gate.cta_settings")}
        </Link>
        <Link
          to="/browse"
          className="px-5 py-3 text-[var(--color-ivoire-soft)] text-[10px] uppercase tracking-[0.22em] hover:text-[var(--color-or)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
      </div>
    </main>
  );
}
