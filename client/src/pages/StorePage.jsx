import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigures } from "../hooks/useCollection.js";
import {
  useSetStoreFigures,
  useStore,
  useStoreCatalog,
} from "../hooks/useStores.js";
import { ApiError } from "../lib/api.js";
import { safeHref } from "../lib/safeUrl.js";
import { buildBuyUrl } from "../lib/storeLink.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import PageSkeleton, { SectionSkeleton } from "../components/Skeleton.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Lightbox from "../components/Lightbox.jsx";
import StatCard from "../components/StatCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/** The storefront's colour signature — a curated "nuit" indigo that sets the
 *  boutique apart from the gold-default entity pages. Every consumer mixes
 *  this theme var() to transparency so accents flip with the light/dark theme.
 *  Direction A keeps the chrome quiet: this tints only the logo frame + a few
 *  hairlines; red stays the single hot accent (the AccentTitle word, the visit
 *  CTA) and gold is reserved for value/rules. */
const STORE_ACCENT = "var(--color-indigo)";

/**
 * /stores/:slug — the storefront page.
 *
 * Hero spread up top with the store's profile image (256px square),
 * name, optional URL chip, and description. Catalogue grid below
 * showing every figure at least one user has linked to this store via
 * an owned_item or a preorder. NSFW figures honoured per the user's
 * `nsfw_visibility` preference (the server filters them out when
 * `hide`).
 */
export default function StorePage() {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const { slug } = useParams();
  const store = useStore(slug);
  const catalog = useStoreCatalog(slug);
  // Lightbox state must live above any early-return below or React refuses
  // to keep the hook order stable across renders.
  const [zoomOpen, setZoomOpen] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (store.isError) {
    const notFound = store.error instanceof ApiError && store.error.status === 404;
    // Direction A empty-state Card: faint kanji watermark + accent eyebrow +
    // title + gold-rule + a red CTA back to the boutiques list.
    return (
      <AppShell>
        <main className="max-w-5xl mx-auto px-6 py-20">
          <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
            <span
              aria-hidden
              className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none"
            >
              店
            </span>
            <p className="micro relative">{t("store.eyebrow")}</p>
            <h1 className="display text-4xl mt-3 text-[var(--color-ivoire)] relative">
              {notFound ? t("store.missing.title") : t("error.unknown")}
            </h1>
            <div className="gold-rule mx-auto w-20 my-8" />
            <Link to="/collection" className="relative inline-flex">
              <Button variant="ghost">
                {t("store.back", { default: "Retour à ma collection" })}
              </Button>
            </Link>
          </Card>
        </main>
      </AppShell>
    );
  }
  if (store.isLoading || !store.data) {
    return (
      <AppShell>
        <PageSkeleton blocks={3} />
      </AppShell>
    );
  }

  const s = store.data;
  const figures = catalog.data ?? [];
  const blurNsfw = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  const imageUrl = s.image_storage_key ? `/api/store-image/${s.id}` : null;
  const visitHref = safeHref(s.url);

  // Figurine metrics derived from the catalogue this store carries — counts
  // only (no manga "completion"; no value, which would need owned-item prices
  // we don't have here). Distinct manufacturers + types give the boutique a
  // glanceable scale. Computed inline (the list is already in memory and tiny).
  const makerCount = new Set(
    figures.map((f) => f.manufacturer_name).filter(Boolean),
  ).size;
  const typeCount = new Set(
    figures.map((f) => f.figure_type).filter(Boolean),
  ).size;

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-12">
          {/* Calm 店 ("shop") watermark — gold, very faint, bleeding off the
              top-right corner. Static + pointer-inert: GPU-free atmosphere
              (no animated mesh / blur, per Direction A). */}
          <span
            aria-hidden
            className="kanji-mark text-[22rem] md:text-[26rem] -top-28 -right-10 hidden md:block select-none"
          >
            店
          </span>

          <div className="relative grid md:grid-cols-[200px_1fr] gap-8 lg:gap-10 items-start">
            {/* Logo well — the storefront's profile image (or a 店 placeholder),
                framed with the existing gold-notch vitrine. Indigo only tints
                the frame so the boutique keeps a quiet identity of its own. */}
            <Reveal
              as="div"
              y={20}
              className="store-hero-frame group max-w-[200px] md:max-w-none"
              style={{
                borderColor: `color-mix(in oklab, ${STORE_ACCENT} 38%, transparent)`,
                boxShadow: `0 24px 60px -32px color-mix(in oklab, ${STORE_ACCENT} 55%, transparent), 0 0 0 1px color-mix(in oklab, var(--color-or) 14%, transparent)`,
              }}
            >
              {/* Accent tint riding over the profile image — faint, GPU-cheap,
               *  fades on hover so the photo reads clean when inspected. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 z-[1] opacity-70 transition-opacity duration-500 ease-out group-hover:opacity-30 motion-reduce:transition-none"
                style={{
                  background: `linear-gradient(150deg, transparent 48%, color-mix(in oklab, ${STORE_ACCENT} 20%, transparent))`,
                }}
              />
              {imageUrl ? (
                // Click-to-zoom on the profile image. Opens the shared Lightbox
                // which already brings wheel/double-click/keyboard zoom on top
                // of the fullscreen view — so the click is the only thing the
                // user has to learn. Subtle 拡 hint surfaces on hover/focus.
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  aria-label={t("photos.view")}
                  className="store-hero-zoom-btn"
                >
                  <img
                    src={imageUrl}
                    alt=""
                    aria-hidden
                    className="store-hero-image"
                  />
                  <span aria-hidden className="store-hero-zoom-hint">
                    <span className="ja">拡</span>
                  </span>
                </button>
              ) : (
                <div aria-hidden className="store-hero-placeholder">
                  店
                </div>
              )}
            </Reveal>

            <Reveal as="div" delay={0.08} y={20} className="min-w-0">
              {/* Kicker: KICKER · 店 · LABEL — the Direction A editorial eyebrow. */}
              <p className="micro flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
                />
                {t("store.eyebrow")}
                <span aria-hidden className="ja not-italic text-[var(--color-or)]">
                  店
                </span>
                {t("store.kicker_label", { default: "BOUTIQUE" })}
              </p>
              <h1 className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95]">
                <AccentTitle text={s.name} />
              </h1>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/60 mt-3">
                /{s.slug}
              </p>
              <div
                className="gold-rule w-24 mt-6"
                style={{
                  background: `linear-gradient(to right, ${STORE_ACCENT} 0%, var(--color-or) 70%, transparent)`,
                }}
              />
              {s.description ? (
                <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl whitespace-pre-wrap">
                  {s.description}
                </p>
              ) : null}

              {/* Visit CTA — the page's single hot action, the Direction A red
                  hanko pill. Rendered as the <a> itself (not a <button> nested
                  in an <a>, which would be invalid markup + a double tab stop):
                  it mirrors the <Button variant="primary"> look with the same
                  Tailwind utilities + inline laque var()s, so it stays on-token
                  and theme-driven. The host rides along as a quiet mono
                  sub-label; gold-outline ghost is reserved for the per-figure
                  buy chips below. */}
              {visitHref ? (
                <a
                  href={visitHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${t("store.visit")} · ${prettyHost(s.url)}`}
                  className="group/visit tap-target relative overflow-hidden inline-flex items-center justify-center gap-2 mt-7 px-6 rounded-full font-medium tracking-wide text-[var(--color-ivoire)] transition-colors duration-300 hover:bg-[var(--color-laque-bright)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)] focus-visible:ring-[var(--color-laque-bright)]"
                  style={{
                    background: "var(--color-laque)",
                    boxShadow:
                      "0 10px 28px -12px color-mix(in oklab, var(--color-laque) 55%, transparent)",
                  }}
                >
                  <span aria-hidden className="ja text-lg leading-none -ml-1">
                    購
                  </span>
                  <span>{t("store.visit")}</span>
                  <span
                    aria-hidden
                    className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-75"
                  >
                    ↗ {prettyHost(s.url)}
                  </span>
                </a>
              ) : null}

              {/* Figurine-metric strip — glanceable scale of the boutique's
                  catalogue. Counts only (ivoire / red), so gold stays for value
                  figures elsewhere. Hidden until the catalogue has loaded with
                  at least one figure. */}
              {figures.length ? (
                <div className="mt-8 grid grid-cols-2 lg:grid-cols-3 gap-3">
                  <StatCard
                    label={t("store.kpi.pieces", { default: "Pièces" })}
                    value={figures.length}
                  />
                  <StatCard
                    label={t("store.kpi.makers", { default: "Fabricants" })}
                    value={makerCount}
                  />
                  <StatCard
                    label={t("store.kpi.types", { default: "Types" })}
                    value={typeCount}
                  />
                </div>
              ) : null}
            </Reveal>
          </div>
        </header>

        {/* ─── Catalogue section ─── */}
        <section className="relative">
          <Reveal
            as="header"
            y={16}
            amount={0.6}
            className="flex items-end justify-between mb-7 gap-4 flex-wrap"
          >
            <div>
              <p className="micro flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-or)] leading-none"
                >
                  棚
                </span>
                {t("store.catalog.eyebrow", { default: "AU RAYON" })}
              </p>
              <h2 className="display text-3xl mt-2 text-[var(--color-ivoire)] leading-tight">
                {t("store.catalog.title")}
              </h2>
              <div className="gold-rule w-16 mt-4" />
            </div>
            <div className="flex items-center gap-3 pb-1">
              <p className="micro-tight">
                {t("store.catalog.count", { n: figures.length })}
              </p>
              {isAdmin && !bulkEditing ? (
                <button
                  type="button"
                  onClick={() => setBulkEditing(true)}
                  className="tap-target text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 transition-colors"
                >
                  ✎ {t("store.catalog.bulk_edit")}
                </button>
              ) : null}
            </div>
          </Reveal>

          {bulkEditing ? (
            <BulkEditCatalog
              storeId={s.id}
              currentlyLinkedIds={figures.map((f) => f.id)}
              onDone={() => setBulkEditing(false)}
              t={t}
            />
          ) : catalog.isLoading ? (
            <p
              role="status"
              aria-live="polite"
              className="text-center text-[var(--color-ivoire-soft)] py-12"
            >
              …
            </p>
          ) : figures.length === 0 ? (
            // Direction A empty-state Card — faint 棚 ("shelf") watermark, accent
            // eyebrow, gold-rule. No CTA here: linking a figure to a store is a
            // side effect of owning/pre-ordering it, not an action taken here.
            <Card className="max-w-lg mx-auto p-10 text-center relative overflow-hidden">
              <span
                aria-hidden
                className="ja absolute -top-6 -right-4 text-[12rem] text-[var(--color-or)]/10 leading-none select-none"
              >
                棚
              </span>
              <p className="micro relative">{t("store.catalog.eyebrow", { default: "AU RAYON" })}</p>
              <div className="gold-rule mx-auto w-16 my-6" />
              <p className="relative text-[var(--color-ivoire-soft)] italic leading-relaxed">
                {t("store.catalog.empty")}
              </p>
            </Card>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {figures.map((f, i) => {
                // Per-figure buy shortcut: this figure's product page at THIS
                // store. Rendered as a sibling of the card's Link (never nested)
                // so the card still opens the figure detail page on click.
                const buyHref = buildBuyUrl(s.url, f.link);
                return (
                  <Reveal
                    as="li"
                    key={f.id}
                    y={24}
                    amount={0.15}
                    delay={Math.min(i, 7) * 0.05}
                    className="relative group/scard"
                  >
                    <FigureCard
                      figureId={f.id}
                      href={`/figures/${f.id}`}
                      name={f.name}
                      type={f.figure_type}
                      manufacturer={f.manufacturer_name}
                      imageUrl={
                        f.primary_photo_id
                          ? `/api/figure-photos/${f.primary_photo_id}`
                          : null
                      }
                      blurImage={f.is_nsfw && blurNsfw}
                    />
                    {buyHref ? (
                      <a
                        href={buyHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="fc-buy"
                        aria-label={t("store.catalog.buy_aria", { name: f.name })}
                      >
                        <span aria-hidden className="ja">購</span>
                        <span>{t("figure.stores.buy")}</span>
                        <span aria-hidden className="fc-buy-arrow">↗</span>
                      </a>
                    ) : null}
                  </Reveal>
                );
              })}
            </ul>
          )}
        </section>

      </main>

      {imageUrl ? (
        <Lightbox
          open={zoomOpen}
          slides={[{ src: imageUrl, alt: s.name }]}
          index={0}
          // Single slide — onChange is a no-op (no arrow nav).
          onChange={() => {}}
          onClose={() => setZoomOpen(false)}
        />
      ) : null}
    </AppShell>
  );
}

function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Admin checkbox grid for bulk-editing the figures linked to a store.
 *
 *   - Seeds selection from the currently linked ids
 *   - Search box filters the rendered list by figure name (substring)
 *   - "Select all matching" / "Select none" act on the FILTERED view so
 *     bulk actions stay scoped to what the admin can see
 *   - Save → PUT /admin/stores/:id/figures with the full next list
 *
 * Removes (unchecking a previously-linked figure) only stick until the
 * next owned/preorder write rebinds the pair via the sync triggers —
 * documented in i18n hint at the top of the toolbar.
 */
function BulkEditCatalog({ storeId, currentlyLinkedIds, onDone, t }) {
  const figures = useFigures();
  const save = useSetStoreFigures();
  const [selection, setSelection] = useState(
    () => new Set(currentlyLinkedIds),
  );
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const all = figures.data ?? [];
    const needle = q.trim().toLocaleLowerCase();
    if (!needle) return all;
    return all.filter((f) => f.name.toLocaleLowerCase().includes(needle));
  }, [figures.data, q]);

  const toggle = (id) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelection((prev) => {
      const next = new Set(prev);
      for (const f of filtered) next.add(f.id);
      return next;
    });
  };

  const clearFiltered = () => {
    setSelection((prev) => {
      const next = new Set(prev);
      for (const f of filtered) next.delete(f.id);
      return next;
    });
  };

  const onSave = async () => {
    await save.mutateAsync({ storeId, figureIds: Array.from(selection) });
    onDone();
  };

  return (
    <div>
      <div className="store-bulk-toolbar">
        <span className="store-bulk-toolbar-label">
          {t("store.catalog.bulk_selected", { n: selection.size })}
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("store.catalog.bulk_search_ph")}
          className="store-bulk-search"
        />
        <div className="store-bulk-actions">
          <button
            type="button"
            onClick={selectAllFiltered}
            disabled={filtered.length === 0}
            className="store-bulk-action"
          >
            {t("store.catalog.bulk_select_all")}
          </button>
          <button
            type="button"
            onClick={clearFiltered}
            disabled={filtered.length === 0}
            className="store-bulk-action"
          >
            {t("store.catalog.bulk_select_none")}
          </button>
        </div>
      </div>

      {figures.isLoading ? (
        <SectionSkeleton blocks={2} />
      ) : filtered.length === 0 ? (
        <p className="text-center text-[var(--color-ivoire-soft)] italic py-8">
          {t("store.catalog.bulk_no_match")}
        </p>
      ) : (
        <ul className="store-bulk-grid">
          {filtered.map((f) => {
            const isLinked = selection.has(f.id);
            return (
              <li key={f.id} className={isLinked ? "is-linked" : ""}>
                <label>
                  <input
                    type="checkbox"
                    checked={isLinked}
                    onChange={() => toggle(f.id)}
                  />
                  <span className="store-bulk-row-text">
                    <span className="store-bulk-row-name">{f.name}</span>
                    <span className="store-bulk-row-meta">
                      {f.manufacturer_name ?? "—"}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex justify-end gap-3 pt-3 border-t border-[var(--color-or)]/15">
        <button
          type="button"
          onClick={onDone}
          disabled={save.isPending}
          className="store-bulk-action"
        >
          {t("editor.cancel")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={save.isPending}
          className="store-bulk-action store-bulk-action--primary"
        >
          {save.isPending ? "…" : t("store.catalog.bulk_save")}
        </button>
      </div>
      {save.isError ? (
        <p
          role="alert"
          className="mt-3 text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {save.error?.message}
        </p>
      ) : null}
    </div>
  );
}
