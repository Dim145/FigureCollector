import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useDiscover } from "../hooks/useFollow.js";
import AppShell from "../components/AppShell.jsx";
import StatCard from "../components/StatCard.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { PageLayout, Section, Toolbar } from "../components/layout/index.js";
import { communityKicker } from "./community/CommunityKicker.js";
import CollectorSearch from "./community/CollectorSearch.jsx";
import CollectorRoster, { CollectorRosterSkeleton } from "./community/CollectorRoster.jsx";

/**
 * Collectionneurs (/community) — the directory of public collectors on this
 * instance, rebuilt on the shared foundation (Direction A "Shōjo-Noir").
 *
 * A thin orchestrator: it owns the debounced `useDiscover` query and the search
 * state, derives a community StatCard strip from the already-loaded roster (no
 * extra request), then composes the page-local sub-components under
 * ./community/ inside the standard <PageLayout> (Communauté 縁 kicker + watermark).
 *
 * Logic is unchanged — same debounce, same per-card FollowButton (inside
 * CollectorCard), same-instance only. Quiet chrome on semantic tokens; the
 * figure photography in the cards carries the colour. GPU-light.
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

  // Community metrics straight from the loaded roster — no extra query. They
  // track the active search, and stay figurine/people-flavoured: collectors,
  // their cumulative pieces, and how many the viewer already follows.
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

  const nsfwPref = me.data?.user?.nsfw_visibility;
  const isSearching = debounced.trim().length > 0;
  const showStrip = !discover.isLoading && collectors.length > 0;

  return (
    <AppShell>
      <PageLayout
        kicker={communityKicker(t, t("nav.discover", { default: "Collectionneurs" }).toUpperCase())}
        title={t("discover.page_title")}
        kanji="縁"
        width="standard"
      >
        <p className="max-w-2xl -mt-2 mb-8 leading-relaxed text-[var(--on-surface-muted)]">
          {t("discover.subtitle")}
        </p>

        {/* Community strip — figurine/people metrics for the shown roster. */}
        {showStrip ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
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
          </div>
        ) : null}

        <Section kicker={t("discover.roster_kicker", { default: "LA COMMUNAUTÉ" })} divider>
          <Toolbar
            className="mb-8"
            start={<CollectorSearch value={q} onChange={setQ} count={collectors.length} t={t} />}
          />

          {discover.isLoading ? (
            <CollectorRosterSkeleton t={t} />
          ) : collectors.length === 0 ? (
            <EmptyState
              kanji="衆"
              eyebrow={t("discover.eyebrow")}
              title={
                isSearching
                  ? t("discover.empty.match_title", { default: "Aucune correspondance" })
                  : t("discover.empty.title", { default: "Pas encore de vitrine ouverte" })
              }
              body={isSearching ? t("discover.no_match") : t("discover.empty")}
            />
          ) : (
            <CollectorRoster collectors={collectors} nsfwPref={nsfwPref} t={t} />
          )}
        </Section>
      </PageLayout>
    </AppShell>
  );
}
