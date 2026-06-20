import { Link } from "react-router-dom";
import { appLocale } from "../../lib/locale.js";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT, colorMix, fmtAmount, segmentColor } from "./chapterTheme.js";
import SpendByYearBars from "./charts/SpendByYearBars.jsx";

/**
 * VIII–XII — Lecture approfondie (deep insights, /me/insights). Each chapter
 * self-hides when its slice is empty, so the almanac never shows a blank
 * section. Reuses the shared `.ins-*` classes + the in-page ChapterRule.
 *
 * NB: chapter IX is FIGURINE-series completion (owned / total within a figure
 * line, e.g. a Nendoroid series) — a collection metric, distinct from the
 * manga "complétion" the brief rules out.
 */
export default function InsightsChapters({ insights, t }) {
  if (!insights) return null;
  const spend = insights.spend_by_year ?? [];
  const completion = insights.series_completion ?? [];
  const wl = insights.wishlist_value ?? [];
  const ph = insights.preorder_health ?? {};
  const dna = insights.collection_dna ?? [];
  const hasSpend = spend.length > 0;
  const hasComp = completion.length > 0;
  const hasWl = wl.length > 0 || (insights.wishlist_count ?? 0) > 0;
  const hasPh = (ph.deposits?.length ?? 0) > 0 || (ph.open ?? 0) > 0 || (ph.cancellations ?? 0) > 0;
  const hasDna = dna.length > 0;
  if (!hasSpend && !hasComp && !hasWl && !hasPh && !hasDna) return null;

  const locale = appLocale();

  return (
    <>
      {hasSpend ? (
        <>
          <ChapterRule
            id="ch-spend-year"
            roman="VIII"
            label={t("insights.ch.spend")}
            kanji="費"
            accent={CHAPTER_ACCENT.VIII}
          />
          <div className="ins-panel">
            <div className="overflow-x-auto">
              <SpendByYearBars spend={spend} />
            </div>
          </div>
        </>
      ) : null}

      {hasComp ? (
        <>
          <ChapterRule
            id="ch-completion"
            roman="IX"
            label={t("insights.ch.completion")}
            kanji="揃"
            accent={CHAPTER_ACCENT.IX}
          />
          <div className="ins-panel">
            {completion.map((s) => (
              <div className="ins-comp-row" key={s.series_id}>
                <span className="ins-comp-name">{s.name}</span>
                <span className="ins-comp-num">
                  <b>{s.owned}</b>/{s.total} · {s.pct}%
                </span>
                <span className="ins-comp-track">
                  <span
                    className="ins-comp-fill"
                    style={{ width: `${Math.min(100, Math.max(0, s.pct))}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {hasWl ? (
        <>
          <ChapterRule
            id="ch-wishlist"
            roman="X"
            label={t("insights.ch.wishlist")}
            kanji="望"
            accent={CHAPTER_ACCENT.X}
          />
          <div className="ins-panel">
            <div className="ins-kpis">
              <div className="ins-kpi">
                <div className="v gold">
                  {wl[0] ? fmtAmount(wl[0].amount, wl[0].currency, locale) : "—"}
                  {wl.length > 1 ? " …" : ""}
                </div>
                <div className="l">{t("insights.wishlist.total")}</div>
                <div className="s">
                  {t("insights.wishlist.count", { n: insights.wishlist_count ?? 0 })}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {hasPh ? (
        <>
          <ChapterRule
            id="ch-preorders"
            roman="XI"
            label={t("insights.ch.preorders")}
            kanji="予"
            accent={CHAPTER_ACCENT.XI}
          />
          <div className="ins-panel">
            <div className="ins-kpis">
              <div className="ins-kpi">
                <div className="v jade">
                  {ph.deposits?.[0]
                    ? fmtAmount(ph.deposits[0].amount, ph.deposits[0].currency, locale)
                    : "—"}
                </div>
                <div className="l">{t("insights.preorders.deposits")}</div>
              </div>
              <div className="ins-kpi">
                <div className="v">
                  {ph.avg_slip_days != null ? t("insights.days", { n: ph.avg_slip_days }) : "—"}
                </div>
                <div className="l">{t("insights.preorders.avg_slip")}</div>
              </div>
              <div className="ins-kpi">
                <div className="v laque">{ph.cancellations ?? 0}</div>
                <div className="l">{t("insights.preorders.cancellations")}</div>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {hasDna ? <CollectionDna dna={dna} pieces={insights.dna_pieces ?? 0} t={t} /> : null}
    </>
  );
}

/**
 * XII — ADN de collection. The recurring appearance tags read as a genome: a
 * proportional barcode strip, then a clickable legend where each tag links to
 * the catalogue filtered by it. Self-hides upstream when no figure is tagged.
 */
function CollectionDna({ dna, pieces, t }) {
  const max = Math.max(1, ...dna.map((d) => Number(d.count) || 0));
  return (
    <>
      <ChapterRule
        id="ch-dna"
        roman="XII"
        label={t("insights.ch.dna")}
        kanji="姿"
        accent={CHAPTER_ACCENT.XII}
      />
      <div className="ins-panel">
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full border border-[var(--color-or)]/20 mb-7"
          role="presentation"
        >
          {dna.map((d, i) => (
            <span
              key={d.tag}
              title={`${d.tag} · ${d.count}`}
              className="h-full transition-[filter] hover:brightness-125"
              style={{
                flexGrow: Number(d.count) || 1,
                minWidth: "3px",
                background: segmentColor(i),
              }}
            />
          ))}
        </div>

        <ul className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
          {dna.map((d, i) => {
            const share = pieces > 0 ? (Number(d.count) / pieces) * 100 : 0;
            const rel = (Number(d.count) / max) * 100;
            return (
              <li key={d.tag}>
                <Link
                  to={`/catalogue?tag=${encodeURIComponent(d.tag)}`}
                  className="group flex items-baseline gap-3 text-sm"
                  title={t("insights.dna.filter", { tag: d.tag })}
                >
                  <span
                    aria-hidden
                    className="block w-2 h-2 shrink-0 self-center"
                    style={{ background: segmentColor(i) }}
                  />
                  <span className="flex-1 truncate capitalize text-[var(--color-ivoire)] group-hover:text-[var(--color-or-pale)] transition-colors">
                    {d.tag}
                  </span>
                  <span className="font-mono text-[10.5px] tracking-wider text-[var(--color-or-pale)]/80 shrink-0">
                    {d.count}
                  </span>
                  <span className="font-mono text-[10px] w-10 text-right text-[var(--color-ivoire-soft)]/70 shrink-0">
                    {share.toFixed(0)}%
                  </span>
                </Link>
                <span className="mt-1.5 block h-px bg-[var(--color-or)]/10">
                  <span
                    className="block h-full"
                    style={{ width: `${rel}%`, background: colorMix("var(--color-neon-cyan)", 60) }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        <p className="micro-tight mt-6 text-center opacity-70">
          {t("insights.dna.caption", { n: pieces })}
        </p>
      </div>
    </>
  );
}
