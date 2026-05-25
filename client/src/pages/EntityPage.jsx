import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell.jsx";
import FigureCard from "../components/FigureCard.jsx";
import { useT } from "../i18n/index.jsx";
import { api, ApiError } from "../lib/api.js";
import { resolveFigureCover } from "../lib/coverUrl.js";
import { useMe } from "../hooks/useMe.js";
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
  const { slug } = useParams();

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

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <Header entity={entity} kind={kind} t={t} />

        <section className="mt-10">
          <header className="flex items-baseline justify-between mb-6">
            <h2 className="display text-2xl text-[var(--color-ivoire)]">
              {t("entity.figures_section.title")}
            </h2>
            <span className="micro-tight">
              {figures.length} {t("entity.figures_section.count")}
            </span>
          </header>

          {figures.length === 0 ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] italic text-center py-12">
              {t("entity.figures_section.empty")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {figures.map((f, i) => (
                <li
                  key={f.id}
                  className="reveal"
                  style={{ "--i": Math.min(i, 10) + 5 }}
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
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — hero with image, name, optional metadata rows

function Header({ entity, kind, t }) {
  return (
    <header className="grid md:grid-cols-[260px_1fr] gap-8 items-start">
      <div className="aspect-[3/4] bg-[var(--color-noir-deep)] border border-[var(--color-or)]/20 overflow-hidden">
        {entity.image_url ? (
          <img
            src={entity.image_url}
            alt={entity.name}
            className="w-full h-full object-cover"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-[var(--color-or)]/30 text-xs uppercase tracking-[0.2em]">
            {t(`entity.${kind}.no_image`)}
          </div>
        )}
      </div>

      <div>
        <p className="micro">{t(`entity.${kind}.eyebrow`)}</p>
        <h1 className="display text-4xl md:text-5xl mt-2 text-[var(--color-ivoire)] leading-tight">
          {entity.name}
        </h1>
        <div className="gold-rule w-24 mt-5 mb-6 opacity-70" />

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

        <MetaRows entity={entity} kind={kind} t={t} />

        <ExternalLinks entity={entity} kind={kind} t={t} />
      </div>
    </header>
  );
}

function MetaRows({ entity, kind, t }) {
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
          <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/80">
            {t(`entity.meta.${k}`)}
          </dt>
          <dd className="text-[var(--color-ivoire)]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ExternalLinks({ entity, kind, t }) {
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
      {links.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)]/40 text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] px-3 py-1.5 transition-all"
          >
            {l.label} ↗
          </a>
        </li>
      ))}
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
