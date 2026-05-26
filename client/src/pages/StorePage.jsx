import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigures } from "../hooks/useCollection.js";
import {
  useSetStoreFigures,
  useStore,
  useStoreCatalog,
} from "../hooks/useStores.js";
import { ApiError } from "../lib/api.js";
import AppShell from "../components/AppShell.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Lightbox from "../components/Lightbox.jsx";

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
    return (
      <AppShell>
        <main className="max-w-5xl mx-auto px-6 py-20 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">
            {notFound ? "404" : "—"}
          </p>
          <h1 className="display text-3xl text-[var(--color-ivoire)] mt-3">
            {notFound ? t("store.missing.title") : t("error.unknown")}
          </h1>
        </main>
      </AppShell>
    );
  }
  if (store.isLoading || !store.data) {
    return (
      <AppShell>
        <main className="max-w-5xl mx-auto px-6 py-20 text-center text-[var(--color-ivoire-soft)]">
          …
        </main>
      </AppShell>
    );
  }

  const s = store.data;
  const figures = catalog.data ?? [];
  const blurNsfw = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  const imageUrl = s.image_storage_key ? `/api/store-image/${s.id}` : null;

  return (
    <AppShell>
      <main className="relative max-w-7xl mx-auto px-6 py-16">
        {/* ── HERO ── */}
        <header className="store-hero reveal" style={{ "--i": 0 }}>
          <div className="store-hero-frame">
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
          </div>
          <div>
            <p className="micro">{t("store.eyebrow")}</p>
            <h1 className="display text-5xl md:text-6xl text-[var(--color-ivoire)] mt-2 leading-none">
              {s.name}
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/60 mt-3">
              /{s.slug}
            </p>
            <div className="gold-rule w-16 mt-5" />
            {s.description ? (
              <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl whitespace-pre-wrap">
                {s.description}
              </p>
            ) : null}
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="store-hero-url"
              >
                ↗ {prettyHost(s.url)}
              </a>
            ) : null}
          </div>
        </header>

        {/* ── CATALOGUE ── */}
        <section className="reveal" style={{ "--i": 1 }}>
          <div className="flex items-baseline justify-between mb-6 gap-4">
            <h2 className="display text-2xl text-[var(--color-ivoire)]">
              {t("store.catalog.title")}
            </h2>
            <div className="flex items-center gap-3">
              <p className="micro-tight">
                {t("store.catalog.count", { n: figures.length })}
              </p>
              {isAdmin && !bulkEditing ? (
                <button
                  type="button"
                  onClick={() => setBulkEditing(true)}
                  className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5 transition-colors"
                >
                  ✎ {t("store.catalog.bulk_edit")}
                </button>
              ) : null}
            </div>
          </div>

          {bulkEditing ? (
            <BulkEditCatalog
              storeId={s.id}
              currentlyLinkedIds={figures.map((f) => f.id)}
              onDone={() => setBulkEditing(false)}
              t={t}
            />
          ) : catalog.isLoading ? (
            <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
          ) : figures.length === 0 ? (
            <p className="text-center text-[var(--color-ivoire-soft)] italic py-12">
              {t("store.catalog.empty")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {figures.map((f, i) => (
                <li key={f.id} className="reveal" style={{ "--i": Math.min(i, 10) + 2 }}>
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
                </li>
              ))}
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
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
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
