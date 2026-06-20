import { Link } from "react-router-dom";
import Reveal from "../../components/motion/Reveal.jsx";
import { appLocale } from "../../lib/locale.js";
import ChapterRule from "./ChapterRule.jsx";
import { CHAPTER_ACCENT, colorMix, fmtAmount } from "./chapterTheme.js";
import PriceThermometer from "./charts/PriceThermometer.jsx";

/**
 * VI — Pièces majeures + VII — Échelle des prix. The crown piece(s) (most
 * expensive per currency) as feature cards, then the per-currency price-scale
 * thermometers. The price chapter self-hides when there's no distribution.
 */
export default function CrownPriceChapter({ data, t }) {
  const hasPrice = (data.price_distribution ?? []).length > 0;
  return (
    <>
      <ChapterRule
        id="ch-crown"
        roman="VI"
        label={t("stats.ch.crown")}
        kanji="王"
        accent={CHAPTER_ACCENT.VI}
      />
      <CrownPieces data={data} t={t} />

      {hasPrice ? (
        <>
          <ChapterRule
            id="ch-scale"
            roman="VII"
            label={t("stats.ch.scale")}
            kanji="幅"
            accent={CHAPTER_ACCENT.VII}
          />
          <Reveal as="div" y={24} className="space-y-12">
            {data.price_distribution.map((p) => (
              <PriceThermometer key={p.currency} dist={p} t={t} />
            ))}
          </Reveal>
        </>
      ) : null}
    </>
  );
}

function CrownPieces({ data, t }) {
  const locale = appLocale();
  if ((data.most_expensive ?? []).length === 0) {
    return (
      <p className="text-center text-[var(--color-ivoire-soft)] italic py-8">
        {t("stats.most_expensive.empty")}
      </p>
    );
  }
  return (
    <Reveal as="div" y={24} className="grid lg:grid-cols-2 gap-6">
      {data.most_expensive.map((m, i) => (
        <article key={`${m.currency}-${m.figure_id}`} className="crown-card">
          <span
            aria-hidden
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: `linear-gradient(90deg, transparent, ${colorMix(
                "var(--color-laque-bright)",
                70,
              )} 30%, ${colorMix("var(--color-or)", 60)} 70%, transparent)`,
            }}
          />
          <p className="crown-eyebrow">
            {t("stats.most_expensive.eyebrow")} · {m.currency}
          </p>
          <h3 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-3 leading-tight">
            <Link
              to={`/figures/${m.figure_id}`}
              className="hover:text-[var(--color-or-pale)] transition-colors"
            >
              {m.figure_name}
            </Link>
          </h3>
          <div
            className="w-12 h-px mt-5 mb-4 opacity-80"
            style={{
              background: `linear-gradient(90deg, ${colorMix(
                "var(--color-laque-bright)",
                90,
              )}, ${colorMix("var(--color-or)", 80)})`,
            }}
          />
          <p className="display font-light text-4xl md:text-5xl text-[var(--color-or)]">
            {fmtAmount(m.price, m.currency, locale)}
            <span className="font-mono text-base text-[var(--color-or-pale)]/70 ml-3 align-baseline">
              {m.currency}
            </span>
          </p>
          {m.purchase_date ? (
            <p className="micro-tight mt-5">
              {t("stats.most_expensive.acquired")} ·{" "}
              <time dateTime={m.purchase_date}>
                {new Date(m.purchase_date).toLocaleDateString(locale, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </p>
          ) : null}
          <span
            aria-hidden
            className="absolute bottom-4 right-5 font-mono text-[9px] tracking-[0.3em] uppercase"
            style={{ color: colorMix("var(--color-laque-bright)", 55) }}
          >
            n<sup>o</sup> {i + 1}
          </span>
        </article>
      ))}
    </Reveal>
  );
}
