import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useDiscover } from "../hooks/useFollow.js";
import AppShell from "../components/AppShell.jsx";
import CollectorCard from "../components/CollectorCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * Découvrir (Lot 4) — a gallery of public collectors on this instance, each
 * framed like an exhibition piece. Search filters by name / handle; the rest
 * is CollectorCard. Same-instance only (no federation).
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

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const locale = me.data?.user?.locale;
  const nsfwPref = me.data?.user?.nsfw_visibility;
  const collectors = discover.data ?? [];

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] sm:text-[24rem] -top-20 right-0 select-none"
        >
          衆
        </span>

        <Reveal as="header" className="relative mb-8" y={20}>
          <p className="micro">{t("discover.eyebrow")}</p>
          <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2 text-[var(--color-ivoire)] leading-[0.98]">
            {t("discover.title")}
          </h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("discover.subtitle")}
          </p>
        </Reveal>

        <Reveal as="div" delay={0.06} y={16} className="relative flex items-center gap-5 flex-wrap mb-8">
          <div className="relative flex-1 min-w-[220px] max-w-[30rem]">
            <span aria-hidden className="ja absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-or-pale)]">
              探
            </span>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("discover.search")}
              aria-label={t("discover.search")}
              className="w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_22%,transparent)] text-[var(--color-ivoire)] pl-10 pr-3 py-[0.7rem] text-sm outline-none focus:border-[var(--color-or)]"
            />
          </div>
          <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-ivoire-soft)]">
            <b className="display text-[1.5rem] text-[var(--color-or-pale)] font-light not-italic">
              {collectors.length}
            </b>{" "}
            {t("discover.count")}
          </span>
        </Reveal>

        {discover.isLoading ? (
          <p className="relative text-center text-[var(--color-ivoire-soft)] py-12">…</p>
        ) : collectors.length === 0 ? (
          <p className="relative text-center text-[var(--color-ivoire-soft)] py-12">
            {debounced ? t("discover.no_match") : t("discover.empty")}
          </p>
        ) : (
          <ul className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collectors.map((c, i) => (
              <Reveal as="li" key={c.id} delay={Math.min(i, 7) * 0.05} y={24}>
                <CollectorCard c={c} locale={locale} nsfwPref={nsfwPref} t={t} />
              </Reveal>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
