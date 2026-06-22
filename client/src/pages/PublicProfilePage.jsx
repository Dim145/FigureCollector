import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeftRight } from "lucide-react";
import { useT, useI18n } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { usePublicProfile, useCompare } from "../hooks/useProfile.js";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { Button, StatCard, EmptyState, SegmentedControl, Spinner } from "../components/ui/index.js";
import { PageLayout, Section } from "../components/layout/index.js";
import Money from "../components/Money.jsx";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import FollowButton from "../components/FollowButton.jsx";
import FollowListModal from "../components/FollowListModal.jsx";
import ProfileAvatar from "./profile/ProfileAvatar.jsx";
import CountButton from "./profile/CountButton.jsx";
import TypeFilter from "./profile/TypeFilter.jsx";
import VitrineGrid from "./profile/VitrineGrid.jsx";
import ForSaleGrid from "./profile/ForSaleGrid.jsx";
import DioramaShelf from "./vitrines/DioramaShelf.jsx";

/**
 * /u/:slug — a collector's public vitrine (Direction A "Shōjo-Noir"), rebuilt on
 * the shared foundation.
 *
 * Thin orchestrator: it loads the profile, derives a couple of view bits, and
 * composes the shared frame (`PageLayout` → `Section`) with page-local pieces
 * (`ProfileAvatar`, `CountButton`, `TypeFilter`, `VitrineGrid`, `ForSaleGrid`,
 * and the shared `DioramaShelf`). The editorial header lives in a custom
 * `titleNode` so the
 * avatar + handle + follow + counts read as one block under the signature
 * red-accent name; everything below is a `Section`.
 *
 * Privacy is enforced server-side and mirrored here unchanged: NSFW figures are
 * already filtered out of `collection` / `stats`, and `value` arrives empty
 * unless the owner published their cote — so the gold value card simply never
 * renders when there's nothing to show. GPU-light: flat fills, hairlines, the
 * shared `Reveal` enter motion; no animated meshes / blur / glows.
 */
export default function PublicProfilePage() {
  const { slug } = useParams();
  const t = useT();
  const { locale: uiLocale } = useI18n();
  const me = useMe();
  const profile = usePublicProfile(slug);
  const figureTypes = useFigureTypes();
  // Affinity teaser: only fire the (heavier) compare for an authed viewer who
  // isn't looking at their own profile. Prefills the cache for /compare too.
  const viewerCanCompare =
    !!me.data?.authenticated &&
    me.data?.user?.username?.toLowerCase() !== slug?.toLowerCase();
  const compare = useCompare(slug, { enabled: viewerCanCompare });
  const [list, setList] = useState(null);
  const [vitrineView, setVitrineView] = useState("grid"); // "grid" | "diorama"
  const [typeFilter, setTypeFilter] = useState(null); // figure_type id | null = all

  const collection = profile.data?.collection;

  // Distinct types present in the collection, with counts, in descending order
  // — drives the light chip filter. Memoised so it only recomputes when the
  // collection changes.
  const typeFacets = useMemo(() => {
    if (!collection?.length) return [];
    const counts = new Map();
    for (const e of collection) {
      const ty = e.figure_type ?? "other";
      counts.set(ty, (counts.get(ty) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [collection]);

  // Localized label for a figure type, resolved through the admin-curated
  // registry (custom types added post-build still read correctly), falling back
  // to the `type.<id>` string the rest of the app uses.
  const typeLabel = useMemo(() => {
    const rows = figureTypes.data;
    return (id) => {
      const match = Array.isArray(rows) ? rows.find((ft) => ft.id === id) : null;
      if (match) return (uiLocale === "fr" ? match.label_fr : match.label_en) || id;
      return t(`type.${id}`);
    };
  }, [figureTypes.data, uiLocale, t]);

  const filteredCollection = useMemo(() => {
    if (!collection) return [];
    if (typeFilter == null) return collection;
    return collection.filter((e) => (e.figure_type ?? "other") === typeFilter);
  }, [collection, typeFilter]);

  // No auth gate: the public showcase is viewable by anyone. The server only
  // returns a profile when its owner opted in (`public_profile_enabled`) — a
  // private or unknown slug 404s and we render the "private" state below.
  if (me.isLoading) return null;

  if (profile.isLoading)
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24 text-[var(--color-ivoire-soft)]">
          <Spinner size={28} label={t("common.loading", { default: "Chargement…" })} />
        </div>
      </AppShell>
    );

  if (profile.error || !profile.data)
    return (
      <AppShell>
        <PageLayout
          width="prose"
          breadcrumbs={[
            { label: t("nav.community", { default: "Communauté" }), to: "/community" },
            { label: `@${slug}` },
          ]}
        >
          <EmptyState
            kanji="鍵"
            eyebrow={t("profile.kicker", { default: "COLLECTIONNEUR" })}
            title="404"
            body={t("profile.private")}
          >
            <Link to="/community">
              <Button variant="ghost">{t("nav.discover", { default: "Découvrir" })}</Button>
            </Link>
          </EmptyState>
        </PageLayout>
      </AppShell>
    );

  const { user, stats, collection: coll, social, value } = profile.data;
  const isSelf = social?.is_self ?? me.data?.user?.username === user.username;
  const locale = me.data?.user?.locale;
  // `value` is opt-in (empty array unless the owner published their cote) and
  // already DESC by amount → the dominant currency leads, "…" hints at more.
  const dominantValue = value && value.length ? value[0] : null;
  // Pieces the owner listed for sale / trade — drive the "À vendre" section.
  const forSale = coll.filter((e) => e.for_sale || e.for_trade);
  const showFilter = typeFacets.length > 1;

  // Editorial header — avatar + handle + name + member-since + actions/counts,
  // rendered through PageLayout's `titleNode` slot so it sits under the shared
  // breadcrumb + over the shared gold-rule.
  const header = (
    <div className="flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8 w-full">
      <Reveal as="div" y={18} className="shrink-0">
        <ProfileAvatar src={user.avatar_url} name={user.display_name} />
      </Reveal>

      <div className="min-w-0 flex-1">
        <Reveal as="div" y={18}>
          <p className="micro flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("profile.kicker", { default: "COLLECTIONNEUR" })}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">
              蒐
            </span>
            <span className="normal-case tracking-[0.18em] text-[var(--color-or-pale)]">
              @{user.username}
            </span>
            {social?.follows_viewer ? (
              <span className="fc-chip fc-chip--jade tracking-[0.12em]">
                {t("follow.follows_you")}
              </span>
            ) : null}
          </p>
        </Reveal>

        <Reveal
          as="h1"
          delay={0.06}
          y={18}
          className="display text-4xl sm:text-5xl md:text-6xl mt-2.5 text-[var(--color-ivoire)] leading-[0.98]"
        >
          <AccentName text={user.display_name} />
        </Reveal>

        <Reveal as="p" delay={0.12} className="mt-4 text-sm text-[var(--color-ivoire-soft)]">
          {t("profile.member_since", {
            date: new Date(user.member_since).toLocaleDateString(locale),
          })}
        </Reveal>

        {/* Action row — the red follow pill is the hero CTA; counts open the
            follow-list modal (behaviour unchanged). Hidden on one's own
            profile, where there's nothing to follow. */}
        <Reveal
          as="div"
          delay={0.16}
          y={16}
          className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4"
        >
          {me.data?.authenticated && !isSelf ? (
            <div className="flex flex-wrap items-center gap-3">
              <FollowButton username={user.username} isFollowing={social?.is_following} />
              {/* Right-sized secondary action that doubles as the affinity
                  teaser. Explicit font-sans + size so it never inherits the
                  PageLayout <h1> display font (the old giant-button bug). */}
              <Link
                to={`/u/${user.username}/compare`}
                title={t("compare.title", { name: user.display_name })}
                aria-label={
                  compare.data?.affinity != null
                    ? t("compare.cta_aria", {
                        name: user.display_name,
                        pct: compare.data.affinity,
                      })
                    : t("compare.title", { name: user.display_name })
                }
                style={{ fontFamily: "var(--font-sans)" }}
                className="group inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--color-or)]/45 pl-1.5 pr-4 text-[12px] not-italic tracking-[0.04em] text-[var(--color-or)] transition-colors hover:border-[var(--color-or)] hover:bg-[color-mix(in_oklab,var(--color-or)_7%,transparent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-or)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-noir)]"
              >
                <AffinityRing pct={compare.data?.affinity} />
                {t("compare.cta", { default: "Comparer" })}
              </Link>
            </div>
          ) : null}

          <div className="flex items-center gap-5 sm:gap-6">
            <CountButton
              value={social?.followers ?? 0}
              label={t("profile.stat_followers")}
              onClick={() => setList({ tab: "followers" })}
            />
            <span
              aria-hidden
              className="w-px h-8 bg-[color-mix(in_oklab,var(--color-or)_30%,transparent)]"
            />
            <CountButton
              value={social?.following ?? 0}
              label={t("profile.stat_following")}
              onClick={() => setList({ tab: "following" })}
            />
          </div>
        </Reveal>
      </div>
    </div>
  );

  return (
    <AppShell>
      <PageLayout
        kanji="蒐"
        titleNode={header}
        breadcrumbs={[
          { label: t("nav.community", { default: "Communauté" }), to: "/community" },
          { label: `@${user.username}` },
        ]}
      >
        {/* Figurine-metric strip — counts stay ivoire; gold is reserved for the
            Valeur card, shown only when the owner published their cote. */}
        <Reveal
          as="div"
          className={`grid grid-cols-2 gap-3 ${dominantValue ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
        >
          <StatCard label={t("profile.stat_pieces")} value={stats.pieces} />
          <StatCard label={t("profile.stat_series")} value={stats.series_count} />
          <StatCard label={t("profile.stat_manufacturers")} value={stats.manufacturers_count} />
          {dominantValue ? (
            <StatCard
              label={t("profile.value_label")}
              value={
                <>
                  <Money amount={dominantValue.amount} currency={dominantValue.currency} round />
                  {value.length > 1 ? " …" : ""}
                </>
              }
              tone="gold"
            />
          ) : null}
        </Reveal>

        {/* ─── À vendre / à échanger — only when the owner listed pieces ─── */}
        {forSale.length > 0 ? (
          <Section
            kicker={
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className="ja not-italic text-base text-[var(--color-laque-bright)] leading-none"
                >
                  売
                </span>
                {t("profile.for_sale_kicker", { default: "À VENDRE / À ÉCHANGER" })}
              </span>
            }
            divider
            className="mt-12"
          >
            <ForSaleGrid entries={forSale} t={t} />
          </Section>
        ) : null}

        {/* ─── Their vitrine ─── */}
        <Section
          kicker={
            <span className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className="ja not-italic text-base text-[var(--color-or)] leading-none"
              >
                棚
              </span>
              {t("profile.vitrine_kicker", { default: "LA VITRINE" })}
            </span>
          }
          actions={
            coll.length > 0 ? (
              <SegmentedControl
                size="sm"
                aria-label={t("vitrines.view", { default: "Vue" })}
                value={vitrineView}
                onChange={setVitrineView}
                options={[
                  { value: "grid", label: t("vitrines.view.grid", { default: "Grille" }) },
                  { value: "diorama", label: t("vitrines.view.diorama", { default: "Diorama" }) },
                ]}
              />
            ) : null
          }
          divider
          className="mt-12"
        >
          {coll.length === 0 ? (
            <EmptyState
              kanji="空"
              eyebrow={t("collection.empty.eyebrow")}
              title={t("profile.empty.title", { name: user.display_name, default: "Vitrine vide" })}
              body={t("collection.empty.title")}
            />
          ) : vitrineView === "diorama" ? (
            <DioramaShelf
              items={coll.map((e) => ({ ...e, id: e.owned_id }))}
              hrefFor={(o) => `/figures/${o.figure_id}`}
              t={t}
            />
          ) : (
            <>
              {showFilter ? (
                <div className="mb-6">
                  <TypeFilter
                    types={typeFacets}
                    value={typeFilter}
                    total={coll.length}
                    onChange={setTypeFilter}
                    allLabel={t("profile.filter.all", { default: "Tout" })}
                    typeLabel={typeLabel}
                  />
                </div>
              ) : null}
              {filteredCollection.length === 0 ? (
                <EmptyState
                  kanji="無"
                  compact
                  title={t("profile.filter.empty", { default: "Aucune pièce de ce type." })}
                >
                  <Button variant="ghost" onClick={() => setTypeFilter(null)}>
                    {t("profile.filter.reset", { default: "Tout afficher" })}
                  </Button>
                </EmptyState>
              ) : (
                <VitrineGrid entries={filteredCollection} />
              )}
            </>
          )}
        </Section>

        <FollowListModal
          open={!!list}
          slug={user.username}
          initialTab={list?.tab ?? "followers"}
          counts={{ followers: social?.followers ?? 0, following: social?.following ?? 0 }}
          onClose={() => setList(null)}
        />
      </PageLayout>
    </AppShell>
  );
}

/**
 * The display name with the Direction-A first-word red accent — kept inline
 * (instead of `<AccentTitle>`) so it can live in PageLayout's `titleNode` while
 * the shared gold-rule renders below the whole header block. Mirrors
 * `AccentTitle` exactly: first whitespace-delimited word is hanko-red italic,
 * single-word names render fully accented (kept intentionally, even on messy
 * data like "Neta Studio…").
 */
function AccentName({ text }) {
  const str = String(text ?? "");
  const space = str.indexOf(" ");
  if (space === -1) {
    return <span className="italic text-[var(--color-laque-bright)]">{str}</span>;
  }
  const first = str.slice(0, space);
  const rest = str.slice(space + 1);
  return (
    <>
      <span className="italic text-[var(--color-laque-bright)]">{first}</span> {rest}
    </>
  );
}

/**
 * Tiny gold ring inside the "Comparer" pill — the affinity teaser. Fills to the
 * server-computed taste-match %. While the compare query is still loading (or
 * unavailable) it falls back to the ⇄ glyph so the pill always reads as compare.
 * Reuses the back-to-top ring language (instant, GPU-light SVG).
 */
function AffinityRing({ pct }) {
  if (pct == null) {
    return (
      <span aria-hidden className="grid h-[26px] w-[26px] place-items-center">
        <ArrowLeftRight size={14} />
      </span>
    );
  }
  const r = 11;
  const circ = 2 * Math.PI * r;
  return (
    <span aria-hidden className="relative grid h-[26px] w-[26px] place-items-center">
      <svg viewBox="0 0 26 26" className="absolute inset-0 -rotate-90 h-full w-full">
        <circle cx="13" cy="13" r={r} fill="none" stroke="var(--color-or)" strokeOpacity="0.3" strokeWidth="2" />
        <circle
          cx="13"
          cy="13"
          r={r}
          fill="none"
          stroke="var(--color-or)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct / 100)}
        />
      </svg>
      <span className="text-[10px] leading-none tabular-nums">{pct}</span>
    </span>
  );
}
