import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigure, useOwnedItems, usePreorderForOwned } from "../hooks/useCollection.js";
import { useWishlistItems, useAddWishlistItem, useRemoveWishlistItem } from "../hooks/useWishlist.js";
import TrackingChip from "../components/TrackingChip.jsx";
import { useDeleteFigure } from "../hooks/useAdmin.js";
import { useStoresForFigure } from "../hooks/useStores.js";
import { ApiError } from "../lib/api.js";
import { typeHue } from "../lib/typeHue.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import CoverPicker from "../components/CoverPicker.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import FigureHero from "../components/FigureHero.jsx";
import AddToCollectionForm from "../components/AddToCollectionForm.jsx";
import BarcodeDialog from "../components/BarcodeDialog.jsx";
import FigurePhotosSection from "../components/FigurePhotosSection.jsx";
import Foldable from "../components/Foldable.jsx";
import LinkedStoresModal from "../components/LinkedStoresModal.jsx";
import OwnedItemEditor from "../components/OwnedItemEditor.jsx";
import PhotoStrip from "../components/PhotoStrip.jsx";
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
        }}
      />
      <span
        aria-hidden
        className="kanji-mark text-[32rem] -top-16 -left-16 hidden md:block opacity-[0.07]"
      >
        {kanjiForType(f.figure_type)}
      </span>

      <div className="relative max-w-7xl mx-auto px-6 pt-12 md:pt-16 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-14 items-start">
        <FigureHero
          figure={f}
          ownedItemId={ownedRecord?.id ?? null}
          figureTypeKanji={kanjiForType(f.figure_type)}
          nsfwBlurClass={nsfwClass(f.is_nsfw, nsfwPref)}
        />

        <div className="relative pt-2 min-w-0">
          {/* `min-w-0` mirrors the FigureHero side — both grid items need
           *  it for the `1.1fr_1fr` track to resolve correctly. Without it
           *  a long unbreakable token in the title would expand THIS
           *  column's min-content past its share and overflow the page. */}
          {/* Lot stamp + action cluster — allow wrap on narrow viewports so
           *  neither overflows when both are present. */}
          <div
            className="flex flex-wrap items-start justify-between gap-3 reveal"
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
            <DescriptionBlock text={f.description} t={t} delay={5} />
          ) : null}

          <HeadlineSpecs f={f} t={t} delay={6} />

          <div className="mt-9 reveal" style={{ "--i": 7 }}>
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
  return (
    <dl
      className="grid grid-cols-2 gap-x-6 gap-y-1.5 reveal"
      style={{ "--i": delay }}
    >
      {rows.map((r) => (
        <div
          key={r.label}
          className="border-l-2 border-[var(--color-or)]/30 pl-3 py-1"
        >
          <dt className="text-[9.5px] uppercase tracking-[0.28em] text-[var(--color-or-pale)]/70">
            {r.label}
          </dt>
          <dd className="display text-base text-[var(--color-ivoire)] mt-0.5 leading-tight truncate">
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
        <div className="fig-cartouche-stores">
          <button
            type="button"
            onClick={() => setStoresOpen(true)}
            className="fig-cartouche-stores-btn"
          >
            <span className="ja text-[var(--color-or)]" aria-hidden>店</span>
            <span>{t("figure.cartouche.stores")}</span>
            <span className="fig-cartouche-stores-count">{stores.length}</span>
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

// =============================================================================
// OWNER STACK — vertical sequence (no tabs). Heavies go behind teaser cards.
// =============================================================================

function OwnerStack({ f, owned, nsfwPref, t }) {
  return (
    <section className="max-w-7xl mx-auto px-6 mt-16 fig-owner-shell">
      <header className="text-center mb-2">
        <p className="micro">{t("figure.owner.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1">
          {t("figure.owner.title")}
        </h2>
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

      {/* 360° viewer — rendered inline. The capture wizard (TurntableWizard)
       *  is the only heavy interactive surface; it opens itself fullscreen. */}
      <Foldable
        size="minor"
        kanji="巡"
        label={t("figure.owner.tab.scan")}
      >
        <TurntableSection ownedId={owned.id} />
      </Foldable>
    </section>
  );
}

// =============================================================================
// Misc helpers + states
// =============================================================================

function kanjiForType(type) {
  switch (type) {
    case "nendoroid":  return "童";
    case "scale":      return "像";
    case "figma":      return "動";
    case "prize":      return "賞";
    case "trading":    return "交";
    case "statue":     return "彫";
    case "plamo":      return "組";
    case "bishoujo":   return "美";
    case "dakimakura": return "枕";
    default:           return "玩";
  }
}

function DeleteConfirm({ name, t, busy, onCancel, onConfirm }) {
  return (
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
    </div>
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
          className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
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
          className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
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
