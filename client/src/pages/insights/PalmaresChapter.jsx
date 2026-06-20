import Reveal from "../../components/motion/Reveal.jsx";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT } from "./chapterTheme.js";
import Podium from "./charts/Podium.jsx";

/**
 * IV — Palmarès. Three podium columns: top fabricants · séries · sculpteurs.
 * Desktop = three columns; mobile = one.
 */
export default function PalmaresChapter({ data, t }) {
  return (
    <>
      <ChapterRule
        id="ch-palmares"
        roman="IV"
        label={t("stats.ch.tops")}
        kanji="冠"
        accent={CHAPTER_ACCENT.IV}
      />
      <Reveal as="div" y={24} className="grid lg:grid-cols-3 gap-8">
        <Podium title={t("stats.top_manufacturers.title")} rows={data.top_manufacturers} t={t} />
        <Podium title={t("stats.top_series.title")} rows={data.top_series} t={t} />
        <Podium title={t("stats.top_sculptors.title")} rows={data.top_sculptors} t={t} />
      </Reveal>
    </>
  );
}
