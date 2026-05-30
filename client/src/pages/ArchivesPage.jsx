import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useMyStats, useInsights } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * Le cabinet d'archives (Lot 5) — export the signed-in user's own data.
 * Each dataset downloads as CSV (spreadsheet) or JSON (faithful backup);
 * a full single-file JSON snapshot bundles everything. Downloads are plain
 * authenticated <a> links — the session cookie rides along, the server
 * replies with Content-Disposition: attachment.
 */
export default function ArchivesPage() {
  const t = useT();
  const me = useMe();
  const stats = useMyStats();
  const insights = useInsights();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const pieces = stats.data?.total_pieces ?? 0;
  const preorders = stats.data?.preorders?.placed ?? 0;
  const wishes = insights.data?.wishlist_count ?? 0;

  return (
    <AppShell>
      <main className="relative max-w-5xl mx-auto px-6 py-12 sm:py-16">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] sm:text-[24rem] -top-20 right-0 select-none"
        >
          蔵
        </span>

        <Reveal as="header" className="relative mb-8" y={20}>
          <p className="micro">{t("archives.eyebrow")}</p>
          <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2 text-[var(--color-ivoire)] leading-[0.98]">
            {t("archives.title")}
          </h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("archives.subtitle")}
          </p>
        </Reveal>

        <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <ExportCard
            kanji="蒐"
            title={t("archives.collection")}
            count={pieces}
            countLabel={t("archives.count.pieces")}
            cols={t("archives.cols.collection")}
            base="collection"
            t={t}
            delay={0}
          />
          <ExportCard
            kanji="望"
            title={t("archives.wishlist")}
            count={wishes}
            countLabel={t("archives.count.wishes")}
            cols={t("archives.cols.wishlist")}
            base="wishlist"
            t={t}
            delay={0.05}
          />
          <ExportCard
            kanji="予"
            title={t("archives.preorders")}
            count={preorders}
            countLabel={t("archives.count.preorders")}
            cols={t("archives.cols.preorders")}
            base="preorders"
            t={t}
            delay={0.1}
          />
        </div>

        <Reveal
          as="div"
          delay={0.16}
          y={16}
          className="relative mt-6 flex items-center justify-between gap-4 flex-wrap p-5 border border-dashed border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] bg-[color-mix(in_oklab,var(--color-or)_3%,transparent)]"
        >
          <p className="text-sm text-[var(--color-ivoire-soft)] max-w-xl">
            <b className="display text-lg text-[var(--color-ivoire)]">{t("archives.backup.title")}</b>{" "}
            — {t("archives.backup.body")}
          </p>
          <a
            href="/api/me/export/backup.json"
            download
            className="dl-btn dl-btn--json whitespace-nowrap"
          >
            ↓ {t("archives.backup.download")}
          </a>
        </Reveal>
      </main>
    </AppShell>
  );
}

function ExportCard({ kanji, title, count, countLabel, cols, base, t, delay }) {
  return (
    <Reveal
      as="article"
      delay={delay}
      y={24}
      className="relative flex flex-col bg-[var(--color-noir-soft)] border border-[color-mix(in_oklab,var(--color-or)_16%,transparent)] p-[1.3rem_1.4rem_1.4rem]"
    >
      <span
        aria-hidden
        className="ja absolute top-4 right-4 text-[2.4rem] text-[color-mix(in_oklab,var(--color-or)_12%,transparent)]"
      >
        {kanji}
      </span>
      <div className="display text-2xl text-[var(--color-ivoire)]">{title}</div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="display text-2xl text-[var(--color-or-pale)]">{count}</span>
        <span className="micro-tight">{countLabel}</span>
      </div>
      <p className="my-4 text-[11px] leading-relaxed text-[var(--color-ivoire-soft)] border-l-2 border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] pl-3">
        <span className="block text-[9px] tracking-[0.16em] uppercase text-[var(--color-or-pale)] mb-1">
          {t("archives.columns")}
        </span>
        {cols}
      </p>
      <div className="mt-auto flex gap-2">
        <a href={`/api/me/export/${base}.csv`} download className="dl-btn dl-btn--csv flex-1">
          ↓ CSV
        </a>
        <a href={`/api/me/export/${base}.json`} download className="dl-btn dl-btn--json flex-1">
          ↓ JSON
        </a>
      </div>
    </Reveal>
  );
}
