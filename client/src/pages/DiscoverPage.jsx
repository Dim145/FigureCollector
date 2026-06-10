import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useDiscover } from "../hooks/useFollow.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import CollectorCard from "../components/CollectorCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * Découvrir (Lot 4) — the public collectors on this instance, redrawn to
 * Direction A ("Shōjo-Noir"): an editorial header over a quiet gold/jade wash,
 * a community `StatCard` strip derived from the loaded roster, an A-styled
 * search control, then each collector framed as an exhibition `CollectorCard`
 * under a kanji section head. Search filters by name / handle; same-instance
 * only (no federation).
 *
 * Logic is unchanged: the debounced `useDiscover` query, the search box, and
 * the per-card `FollowButton` (inside `CollectorCard`) all behave as before —
 * this pass restyles + restructures the JSX only. The stat strip reuses the
 * already-fetched list (no extra request). GPU-light: flat fills, hairlines,
 * one static wash, the shared `Reveal` enter motion; no meshes / blur / glows.
 */
export default function DiscoverPage() {
  const t = useT();
  const me = useMe();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  // Debounce the search so each keystroke doesn't fire a query.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const discover = useDiscover(debounced);

  const collectors = useMemo(() => discover.data ?? [], [discover.data]);
  // Community metrics straight from the loaded roster — no extra query. These
  // mirror the *currently shown* collectors (so they track the search), and
  // stay figurine/community-flavoured: people, their cumulative pieces, and how
  // many the viewer already follows.
  const community = useMemo(() => {
    let pieces = 0;
    let following = 0;
    for (const c of collectors) {
      pieces += Number(c.pieces) || 0;
      if (c.is_following) following += 1;
    }
    return { collectors: collectors.length, pieces, following };
  }, [collectors]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const locale = me.data?.user?.locale;
  const nsfwPref = me.data?.user?.nsfw_visibility;
  const isSearching = debounced.trim().length > 0;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Quiet gallery wash — a single static gold/jade radial pinned behind
            the header (GPU-free) over the global aurora. Feathered edges so it
            fades into the column instead of hard-cutting. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-0 right-0 h-[380px] -z-0"
          style={{
            background:
              "radial-gradient(46% 62% at 20% 0%, color-mix(in oklab, var(--color-or) 17%, transparent), transparent 70%), radial-gradient(44% 58% at 86% 6%, color-mix(in oklab, var(--color-jade) 13%, transparent), transparent 72%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />

        <span
          aria-hidden
          className="kanji-mark text-[18rem] sm:text-[24rem] -top-24 -right-6 hidden md:block select-none"
        >
          衆
        </span>

        {/* ─── Editorial header ─── */}
        <Reveal as="header" className="relative mb-9" y={20}>
          <p className="micro flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("discover.eyebrow")}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">衆</span>
          </p>
          <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2.5 text-[var(--color-ivoire)] leading-[0.98]">
            <AccentTitle text={t("discover.page_title")} />
          </h1>
          <div className="gold-rule w-24 mt-5" />
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("discover.subtitle")}
          </p>
        </Reveal>

        {/* Community strip — figurine/people metrics for the shown roster.
            Reuses the already-loaded list, so it tracks the active search. */}
        {!discover.isLoading && collectors.length > 0 ? (
          <Reveal
            as="div"
            delay={0.06}
            className="relative mb-9 grid grid-cols-2 lg:grid-cols-3 gap-3"
          >
            <StatCard
              label={
                isSearching
                  ? t("discover.stat.matches", { default: "Résultats" })
                  : t("discover.stat.collectors", { default: "Collectionneurs" })
              }
              value={community.collectors}
            />
            <StatCard
              label={t("discover.stat.pieces", { default: "Pièces exposées" })}
              value={community.pieces}
            />
            <StatCard
              label={t("discover.stat.following", { default: "Que vous suivez" })}
              value={community.following}
              tone="red"
            />
          </Reveal>
        ) : null}

        {/* ─── Search control ─── */}
        <Reveal
          as="div"
          delay={0.1}
          y={16}
          className="relative flex items-end justify-between gap-5 flex-wrap mb-8"
        >
          <label className="relative flex-1 min-w-[220px] max-w-[30rem] block">
            <span className="micro-tight block mb-2">
              {t("discover.search_label", { default: "Chercher" })}
            </span>
            <span className="relative block">
              <span
                aria-hidden
                className="ja absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-or-pale)]"
              >
                探
              </span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("discover.search")}
                aria-label={t("discover.search")}
                className="w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_22%,transparent)] text-[var(--color-ivoire)] pl-10 pr-3 py-[0.7rem] text-sm outline-none transition-colors focus:border-[var(--color-or)]"
              />
            </span>
          </label>
          <p
            role="status"
            aria-live="polite"
            className="font-[var(--font-mono)] text-[11px] text-[var(--color-ivoire-soft)] pb-[0.7rem]"
          >
            <b className="figural text-[1.6rem] text-[var(--color-or-pale)] not-italic align-middle">
              {collectors.length}
            </b>{" "}
            {t("discover.count")}
          </p>
        </Reveal>

        {/* ─── Roster ─── */}
        {discover.isLoading ? (
          <p
            role="status"
            aria-live="polite"
            className="relative text-center text-[var(--color-ivoire-soft)] py-12"
          >
            …
          </p>
        ) : collectors.length === 0 ? (
          <EmptyState searching={isSearching} t={t} />
        ) : (
          <section aria-labelledby="discover-roster-head" className="relative">
            <Reveal as="div" delay={0.12} className="mb-7">
              <p id="discover-roster-head" className="micro flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-or)] leading-none"
                >
                  蒐
                </span>
                {t("discover.roster_kicker", { default: "LA COMMUNAUTÉ" })}
              </p>
              <div className="gold-rule w-16 mt-3" />
            </Reveal>

            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {collectors.map((c, i) => (
                <Reveal as="li" key={c.id} delay={Math.min(i, 7) * 0.05} y={24}>
                  <CollectorCard c={c} locale={locale} nsfwPref={nsfwPref} t={t} />
                </Reveal>
              ))}
            </ul>
          </section>
        )}
      </main>
    </AppShell>
  );
}

/**
 * Empty / no-match state — a Card with a faint 衆 ("crowd") watermark, an
 * eyebrow, a gold-rule and the matching copy. Mirrors the editorial empty
 * states on /collection and the public vitrine.
 */
function EmptyState({ searching, t }) {
  return (
    <Card className="relative max-w-xl mx-auto p-12 text-center overflow-hidden frame-corners">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none"
      >
        衆
      </span>
      <p className="micro relative">{t("discover.eyebrow")}</p>
      <h2 className="display text-3xl mt-3 text-[var(--color-ivoire)] relative">
        {searching
          ? t("discover.empty.match_title", { default: "Aucune correspondance" })
          : t("discover.empty.title", { default: "Pas encore de vitrine ouverte" })}
      </h2>
      <div className="gold-rule mx-auto w-20 my-8" />
      <p className="text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {searching ? t("discover.no_match") : t("discover.empty")}
      </p>
    </Card>
  );
}
