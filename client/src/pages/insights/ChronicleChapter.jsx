import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT } from "./chapterTheme.js";
import PressStrip from "./charts/PressStrip.jsx";

/**
 * V — Chronique. The year-by-year acquisition timeline (press strip). The strip
 * is wide, so it scrolls inside its own `overflow-x:auto` well on mobile — the
 * page itself never side-scrolls. Self-shows an empty line when no years yet.
 */
export default function ChronicleChapter({ data, t }) {
  const years = data.acquisitions_by_year ?? [];
  return (
    <>
      <ChapterRule
        id="ch-chronicle"
        roman="V"
        label={t("stats.ch.timeline")}
        kanji="暦"
        accent={CHAPTER_ACCENT.V}
      />
      {years.length === 0 ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12 italic">
          {t("stats.timeline.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <PressStrip data={years} t={t} />
        </div>
      )}
    </>
  );
}
