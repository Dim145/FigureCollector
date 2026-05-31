import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { useT } from "../i18n/index.jsx";
import { api, ApiError } from "../lib/api.js";
import { resolveFigureCover } from "../lib/coverUrl.js";
import { safeHref } from "../lib/safeUrl.js";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import {
  useUnlinkSeriesFigures,
  useMoveSeriesFigures,
  useUnlinkCharacterFigures,
  useMoveCharacterFigures,
} from "../hooks/useAdmin.js";
import { useSeriesLookup, useCharactersLookup } from "../hooks/useEntities.js";
import { preorderPhaseFromFigure, preorderBadgeLabel } from "../lib/preorderStatus.js";

/**
 * Single React page used for all three "browse by entity" routes:
 *   /manufacturers/:slug   → kind="manufacturer"
 *   /series/:slug          → kind="series"
 *   /characters/:slug      → kind="character"
 *
 * Same shell for all three — only the eyebrow label + a couple of extra
 * metadata rows change. The entity payload comes back from the server
 * already shaped the way we render it (id, name, image_url resolved, etc),
 * so the page is essentially a presenter.
 *
 * @param {object} props
 * @param {"manufacturer"|"series"|"character"} props.kind
 */
export default function EntityPage({ kind }) {
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const { slug } = useParams();
  // Per-figure selection for admin bulk ops (unlink / move). Resets to empty
  // every time the slug changes — different page, different selection set.
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => {
    setSelected(new Set());
  }, [slug, kind]);

  const apiPath = kindToApiPath(kind);
  const q = useQuery({
    queryKey: ["entity", kind, slug],
    queryFn: () => api.get(`/${apiPath}/${encodeURIComponent(slug)}`),
    enabled: !!slug,
    retry: (count, err) => {
      // Don't bother retrying a 404 — the slug is wrong or the entity was
      // deleted, neither resolves on its own.
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  if (q.isLoading) {
    return (
      <AppShell>
        <main className="max-w-6xl mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)] italic">
          …
        </main>
      </AppShell>
    );
  }
  if (q.isError) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <AppShell>
        <main className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="micro">{t(`entity.${kind}.eyebrow`)}</p>
          <h1 className="display text-3xl mt-2 text-[var(--color-ivoire)]">
            {notFound ? t("entity.missing.title") : t("entity.error.title")}
          </h1>
          <p className="text-sm text-[var(--color-ivoire-soft)] mt-4">
            {notFound ? t("entity.missing.body") : q.error?.message}
          </p>
        </main>
      </AppShell>
    );
  }

  const { entity, figures } = q.data ?? { entity: null, figures: [] };
  if (!entity) return <AppShell><main /></AppShell>;

  const blurNsfw =
    (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  // The admin toolbar (checkboxes + unlink / move bulk ops) is only relevant
  // for the two M2M-linked entity kinds — manufacturers are 1:N via a
  // direct FK and not in scope for this issue.
  const manageable = isAdmin && (kind === "series" || kind === "character");

  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () => setSelected(new Set(figures.map((f) => f.id)));
  const clearSelection = () => setSelected(new Set());

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Header entity={entity} kind={kind} t={t} />

        <section className="mt-10">
          <Reveal
            as="header"
            y={16}
            amount={0.6}
            className="flex items-baseline justify-between mb-6"
          >
            <h2 className="display text-2xl text-[var(--color-ivoire)]">
              {t("entity.figures_section.title")}
            </h2>
            <span className="micro-tight">
              {figures.length} {t("entity.figures_section.count")}
            </span>
          </Reveal>

          {manageable && figures.length > 0 ? (
            <AdminBulkToolbar
              kind={kind}
              entity={entity}
              figures={figures}
              selected={selected}
              onSelectAll={selectAll}
              onClear={clearSelection}
              t={t}
            />
          ) : null}

          {figures.length === 0 ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] italic text-center py-12">
              {t("entity.figures_section.empty")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {figures.map((f, i) => {
                const isSelected = selected.has(f.id);
                return (
                  <Reveal
                    as="li"
                    key={f.id}
                    y={24}
                    amount={0.15}
                    delay={Math.min(i, 7) * 0.05}
                  >
                    {/* Selection control sits ABOVE the card, not as a corner
                        overlay — both card corners are already taken (type
                        chip top-left, preorder badge top-right). A labelled
                        bar is also a bigger hit target + screen-reader clear. */}
                    {manageable ? (
                      <label
                        className={`flex items-center gap-2 mb-2 px-2.5 py-2 cursor-pointer select-none text-[10px] uppercase tracking-[0.18em] border transition-colors ${
                          isSelected
                            ? "border-[var(--color-or)] text-[var(--color-or)] bg-[var(--color-or)]/10"
                            : "border-[var(--color-or)]/25 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(f.id)}
                          className="accent-[var(--color-or)] w-4 h-4"
                        />
                        <span>
                          {isSelected
                            ? t("entity.admin.selected_one")
                            : t("entity.admin.select_one")}
                        </span>
                      </label>
                    ) : null}
                    <div
                      className={
                        manageable && isSelected
                          ? "ring-1 ring-[var(--color-or)]"
                          : ""
                      }
                    >
                      <FigureCard
                        figureId={f.id}
                        href={`/figures/${f.id}`}
                        name={f.name}
                        type={f.figure_type}
                        manufacturer={f.manufacturer_name ?? null}
                        imageUrl={resolveFigureCover(f)}
                        scale={f.scale}
                        versionName={f.version_name}
                        blurImage={f.is_nsfw && blurNsfw}
                        badge={(() => {
                          const phase = preorderPhaseFromFigure(f);
                          const label = preorderBadgeLabel(phase, t);
                          return label ? { label, tone: "preorder" } : null;
                        })()}
                      />
                    </div>
                  </Reveal>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin bulk toolbar — appears on series + character pages for admin viewers.
// Mirrors the figure-types ledger styling (mono micro caps, gold border).
// ─────────────────────────────────────────────────────────────────────────────

function AdminBulkToolbar({ kind, entity, figures, selected, onSelectAll, onClear, t }) {
  const [moveTo, setMoveTo] = useState("");
  const isSeries = kind === "series";
  // Call every hook unconditionally — branching on `kind` would put the
  // hooks call order at the mercy of the prop, which rules-of-hooks
  // (rightly) forbids. The unused half is cheap (TanStack Query dedupes).
  const seriesLookup = useSeriesLookup();
  const charLookup = useCharactersLookup();
  const seriesUnlink = useUnlinkSeriesFigures();
  const charUnlink = useUnlinkCharacterFigures();
  const seriesMove = useMoveSeriesFigures();
  const charMove = useMoveCharacterFigures();
  const lookup = isSeries ? seriesLookup : charLookup;
  const unlinkMut = isSeries ? seriesUnlink : charUnlink;
  const moveMut = isSeries ? seriesMove : charMove;
  // The picker excludes the current entity — moving "to self" is a no-op the
  // backend rejects as 400 anyway, no need to surface it as a valid choice.
  const targets = (lookup.data ?? []).filter((row) => row.id !== entity.id);
  const figureIds = Array.from(selected);
  const allSelected = selected.size === figures.length && figures.length > 0;
  const busy = unlinkMut.isPending || moveMut.isPending;

  const onUnlink = async () => {
    if (figureIds.length === 0) return;
    if (isSeries) {
      await unlinkMut.mutateAsync({ seriesId: entity.id, figureIds });
    } else {
      await unlinkMut.mutateAsync({ characterId: entity.id, figureIds });
    }
    onClear();
  };

  const onMove = async () => {
    if (figureIds.length === 0 || !moveTo) return;
    if (isSeries) {
      await moveMut.mutateAsync({
        fromSeriesId: entity.id,
        toSeriesId: moveTo,
        figureIds,
      });
    } else {
      await moveMut.mutateAsync({
        fromCharacterId: entity.id,
        toCharacterId: moveTo,
        figureIds,
      });
    }
    setMoveTo("");
    onClear();
  };

  return (
    <div className="mb-6 p-4 border border-[var(--color-or)]/25 bg-[var(--color-noir-soft)]/40 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-[0.2em]">
      <span className="text-[var(--color-or-pale)]">
        {t("entity.admin.eyebrow")}
      </span>
      <span className="font-mono text-[var(--color-ivoire-soft)]">
        {t("entity.admin.selected_count", { n: selected.size })}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        onClick={allSelected ? onClear : onSelectAll}
        className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] border border-[var(--color-or)]/30 hover:border-[var(--color-or)] px-2.5 py-1 transition-colors"
      >
        {allSelected ? t("entity.admin.deselect_all") : t("entity.admin.select_all")}
      </button>
      <button
        type="button"
        onClick={onUnlink}
        disabled={selected.size === 0 || busy}
        className="text-[var(--color-or-pale)] hover:text-[var(--color-laque-bright)] border border-[var(--color-or)]/30 hover:border-[var(--color-laque-bright)] px-2.5 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ✂ {t("entity.admin.unlink")}
      </button>
      <select
        value={moveTo}
        onChange={(e) => setMoveTo(e.target.value)}
        disabled={selected.size === 0 || busy || targets.length === 0}
        aria-label={t("entity.admin.move_to")}
        className="bg-[var(--color-noir-deep)] border border-[var(--color-or)]/30 px-2.5 py-1 text-[var(--color-ivoire)] disabled:opacity-30"
        style={{ minWidth: "14rem" }}
      >
        <option value="">{t("entity.admin.move_placeholder")}</option>
        {targets.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onMove}
        disabled={selected.size === 0 || !moveTo || busy}
        className="text-[var(--color-or)] hover:text-[var(--color-noir)] border border-[var(--color-or)] hover:bg-[var(--color-or)] px-2.5 py-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        → {t("entity.admin.move_confirm")}
      </button>
      {unlinkMut.isError || moveMut.isError ? (
        <p
          role="alert"
          className="basis-full normal-case tracking-normal text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {(unlinkMut.error || moveMut.error)?.message}
        </p>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — hero with image, name, optional metadata rows

function Header({ entity, kind, t }) {
  const accent = kindAccent(kind);
  return (
    <header className="relative">
      {/* Localised colour-wash behind the hero — a gold→accent mesh that
          tones to the entity kind. Absolutely positioned, aria-hidden and
          pointer-events-none so it's pure decoration; every colour is a
          theme var() (mixed to transparency) so it flips light/dark. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -left-6 -right-6 h-[360px] -z-0"
        style={{
          background: `radial-gradient(48% 70% at 14% 0%, color-mix(in oklab, var(--color-or) 20%, transparent), transparent 70%), radial-gradient(46% 64% at 82% 8%, color-mix(in oklab, ${accent} 20%, transparent), transparent 72%), radial-gradient(40% 56% at 52% 36%, color-mix(in oklab, ${accent} 11%, transparent), transparent 75%)`,
        }}
      />

      <div className="relative grid md:grid-cols-[260px_1fr] gap-8 items-start">
        <Reveal
          as="div"
          y={20}
          className="group relative aspect-[3/4] overflow-hidden border bg-[var(--color-noir-deep)]"
          style={{
            borderColor: `color-mix(in oklab, ${accent} 38%, transparent)`,
            boxShadow: `0 24px 60px -32px color-mix(in oklab, ${accent} 55%, transparent), 0 0 0 1px color-mix(in oklab, var(--color-or) 14%, transparent)`,
          }}
        >
          {/* Accent tint riding over the image — faint, GPU-cheap, fades on
              hover so the photo reads clean when inspected. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 opacity-70 transition-opacity duration-500 ease-out group-hover:opacity-30 motion-reduce:transition-none"
            style={{
              background: `linear-gradient(150deg, transparent 45%, color-mix(in oklab, ${accent} 22%, transparent))`,
            }}
          />
          {entity.image_url ? (
            <img
              src={entity.image_url}
              alt={entity.name}
              className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
              loading="eager"
              decoding="async"
            />
          ) : (
            <div
              className="w-full h-full grid place-items-center text-xs uppercase tracking-[0.2em]"
              style={{ color: `color-mix(in oklab, ${accent} 45%, transparent)` }}
            >
              {t(`entity.${kind}.no_image`)}
            </div>
          )}
        </Reveal>

        <Reveal as="div" delay={0.08} y={20}>
          <p
            className="micro"
            style={{ color: `color-mix(in oklab, ${accent} 60%, var(--color-or-pale))` }}
          >
            {t(`entity.${kind}.eyebrow`)}
          </p>
          <h1
            className="display text-4xl md:text-5xl mt-2 text-[var(--color-ivoire)] leading-tight"
            style={{
              textShadow: `0 0 34px color-mix(in oklab, ${accent} 30%, transparent)`,
            }}
          >
            {entity.name}
          </h1>
          <div
            className="gold-rule w-24 mt-5 mb-6"
            style={{
              background: `linear-gradient(to right, transparent, ${accent} 30%, var(--color-or) 70%, transparent)`,
            }}
          />

        {/* Linked series for characters */}
        {kind === "character" && entity.series_name ? (
          <p className="text-sm text-[var(--color-ivoire-soft)] mb-4">
            <span className="micro-tight mr-2">
              {t("entity.character.from_series")}
            </span>
            <Link
              to={`/series/${entity.series_slug}`}
              className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors underline decoration-[var(--color-or)]/40 underline-offset-4"
            >
              {entity.series_name}
            </Link>
          </p>
        ) : null}

        {entity.description ? (
          // Render as a TEXT node, never as HTML. The previous wiring used
          // `dangerouslySetInnerHTML={{ __html: stripHtml(...) }}` which
          // (a) had nothing to gain — `stripHtml` already removed every
          // tag — and (b) left a residual XSS vector if `stripHtml` ever
          // failed to neutralise a smuggled `<scr<script>ipt>` payload.
          // React auto-escapes text content, so this is unconditionally
          // safe. The `whitespace-pre-wrap` class preserves the `\n` that
          // `stripHtml` produces in place of `<br>` tags.
          <p className="text-sm text-[var(--color-ivoire)] leading-relaxed max-w-prose whitespace-pre-wrap">
            {stripHtml(entity.description)}
          </p>
        ) : null}

          <MetaRows entity={entity} kind={kind} t={t} accent={accent} />

          <ExternalLinks entity={entity} kind={kind} t={t} accent={accent} />
        </Reveal>
      </div>
    </header>
  );
}

function MetaRows({ entity, kind, t, accent = "var(--color-or)" }) {
  const rows = [];
  if (kind === "manufacturer" && entity.country) {
    rows.push(["country", entity.country]);
  }
  if (kind === "series" && entity.origin && entity.origin !== "other") {
    rows.push(["origin", t(`entity.series.origin.${entity.origin}`)]);
  }
  if (rows.length === 0) return null;
  return (
    <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt
            className="text-[10px] uppercase tracking-[0.18em]"
            style={{ color: `color-mix(in oklab, ${accent} 55%, var(--color-or-pale))` }}
          >
            {t(`entity.meta.${k}`)}
          </dt>
          <dd className="text-[var(--color-ivoire)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExternalLinks({ entity, kind, t, accent = "var(--color-or)" }) {
  const links = [];
  if (entity.external_url) {
    links.push({ href: entity.external_url, label: t("entity.link.website") });
  }
  if (entity.website_url) {
    links.push({ href: entity.website_url, label: t("entity.link.website") });
  }
  if (entity.anilist_id) {
    const path = kind === "character" ? "character" : "anime"; // best-effort
    links.push({
      href: `https://anilist.co/${path}/${entity.anilist_id}`,
      label: "AniList",
    });
  }
  if (entity.mal_id) {
    const path = kind === "character" ? "character" : "anime";
    links.push({
      href: `https://myanimelist.net/${path}/${entity.mal_id}`,
      label: "MyAnimeList",
    });
  }
  if (links.length === 0) return null;
  return (
    <ul className="mt-6 flex flex-wrap gap-2">
      {links.map((l) => {
        const href = safeHref(l.href);
        if (!href) return null;
        return (
        <li key={l.href}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] px-3 py-1.5 border transition-colors duration-300 ease-out hover:-translate-y-0.5 hover:text-[var(--color-ivoire)] hover:[border-color:var(--_link-border-hover)] hover:[background:var(--_link-bg-hover)] motion-reduce:hover:translate-y-0 motion-reduce:transition-none"
            style={{
              borderColor: `color-mix(in oklab, ${accent} 42%, transparent)`,
              background: `color-mix(in oklab, ${accent} 6%, transparent)`,
              "--_link-border-hover": `color-mix(in oklab, ${accent} 80%, transparent)`,
              "--_link-bg-hover": `color-mix(in oklab, ${accent} 14%, transparent)`,
            }}
          >
            {l.label} ↗
          </a>
        </li>
        );
      })}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function kindToApiPath(kind) {
  switch (kind) {
    case "manufacturer":
      return "manufacturers";
    case "series":
      return "series";
    case "character":
      return "characters";
    default:
      return kind;
  }
}

/** A tasteful hero accent per entity kind. Series read as jade (céladon),
 *  characters as indigo (nuit), manufacturers stay gold — every value is a
 *  theme var() so the wash flips correctly between light and dark. */
function kindAccent(kind) {
  switch (kind) {
    case "series":
      return "var(--color-jade)";
    case "character":
      return "var(--color-indigo)";
    default:
      return "var(--color-or)";
  }
}

/** AniList descriptions occasionally arrive with `<br>` / `<i>` despite our
 *  `asHtml: false` hint. We do TWO passes:
 *
 *   1. `<br>` → `\n` so paragraph breaks survive (consumers use
 *      `whitespace-pre-wrap` to render them).
 *   2. Drop every `<` and `>` outright with a single-character pattern.
 *      The previous broad `/<[^>]+>/g` strip was multi-character and
 *      therefore smuggleable per CodeQL's
 *      `js/incomplete-multi-character-sanitization`: input like
 *      `<scr<script>ipt>` would yield `<script>` after one pass. The
 *      single-char strip below can't be smuggled.
 */
function stripHtml(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[<>]/g, "")
    .trim();
}
