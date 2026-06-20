import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useActivity } from "../hooks/useActivity.js";
import AppShell from "../components/AppShell.jsx";
import StatCard from "../components/StatCard.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import { PageLayout, Section, Toolbar } from "../components/layout/index.js";
import { communityKicker } from "./community/CommunityKicker.js";
import { deriveStats, groupByDay } from "./community/journalConstants.js";
import JournalFilters from "./community/JournalFilters.jsx";
import JournalFeed from "./community/JournalFeed.jsx";

/**
 * Journal (/community/activity) — the viewer's chronological activity ledger,
 * rebuilt on the shared foundation (Direction A "Shōjo-Noir").
 *
 * A thin orchestrator: it owns the `useActivity` query and the kind-filter
 * state, derives the StatCard counts + the day buckets, then composes the
 * page-local sub-components under ./community/ inside the standard <PageLayout>
 * (Communauté 縁 kicker + watermark). The feed itself is a clean editorial,
 * day-grouped list — quieter and more scannable than the old gold spine, with
 * actor avatars and explicit timestamps.
 *
 * `/me/activity` is the *viewer's own* ledger, so every row's actor is the
 * signed-in user (initial Avatar; no avatar_url on the user yet). GPU-light:
 * tokens, hairlines, opacity/transform hovers, the shared Reveal for enter.
 */
export default function ActivityPage() {
  const t = useT();
  const me = useMe();
  const activity = useActivity({ limit: 200 });

  // Filter — Set<kindId>. Empty Set = show everything (default).
  const [muted, setMuted] = useState(() => new Set());
  const toggle = (id) =>
    setMuted((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const events = useMemo(() => activity.data ?? [], [activity.data]);

  const countsByKind = useMemo(() => {
    const m = new Map();
    for (const e of events) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [events]);

  const stats = useMemo(() => deriveStats(events), [events]);
  const days = useMemo(() => groupByDay(events.filter((e) => !muted.has(e.kind))), [events, muted]);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const user = me.data?.user;
  const actorName = user?.display_name ?? user?.username ?? "?";
  const actorAvatar = user?.avatar_url ?? undefined;

  return (
    <AppShell>
      <PageLayout
        kicker={communityKicker(t, t("activity.title", { default: "Journal" }).toUpperCase())}
        title={t("activity.page_title")}
        kanji="縁"
        width="standard"
      >
        <p className="display italic text-[var(--accent)] text-lg -mt-2 mb-8">
          {t("activity.kicker")}
        </p>

        {/* Activity-count strip — figurine-domain metrics from the loaded window. */}
        {events.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <StatCard
              label={t("activity.stat.entries", { default: "Entrées" })}
              value={stats.total}
            />
            <StatCard
              label={t("activity.stat.acquired", { default: "Acquisitions" })}
              value={stats.acquired}
              tone="gold"
            />
            <StatCard
              label={t("activity.stat.preorders", { default: "Pré-commandes" })}
              value={stats.preorders}
              tone="red"
            />
            <StatCard
              label={t("activity.stat.this_month", { default: "Ce mois-ci" })}
              value={stats.thisMonth}
            />
          </div>
        ) : null}

        <Section kicker={t("activity.subtitle")} divider>
          {events.length > 0 ? (
            <Toolbar
              className="mb-6"
              start={
                <JournalFilters countsByKind={countsByKind} muted={muted} onToggle={toggle} t={t} />
              }
            />
          ) : null}

          {activity.isLoading ? (
            <SectionSkeleton blocks={3} />
          ) : activity.isError ? (
            <EmptyState
              kanji="空"
              hue="var(--danger)"
              title={t("error.unknown")}
              body={t("activity.error.body", {
                default: "Le journal n'a pas pu être chargé. Réessaie dans un instant.",
              })}
            />
          ) : events.length === 0 ? (
            <EmptyState
              kanji="空"
              eyebrow={t("activity.subtitle")}
              title={t("activity.empty.title", { default: "Le journal est vierge." })}
              body={t("activity.empty.body")}
            />
          ) : days.length === 0 ? (
            <EmptyState
              kanji="空"
              title={t("activity.filtered_empty")}
              body={t("activity.filtered_empty.hint", {
                default: "Réactive un type d'événement ci-dessus pour revoir des entrées.",
              })}
            />
          ) : (
            <JournalFeed days={days} actorName={actorName} actorAvatar={actorAvatar} t={t} />
          )}
        </Section>
      </PageLayout>
    </AppShell>
  );
}
