import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useLogout, useMe } from "../hooks/useMe.js";
import ActivityStrip from "../components/ActivityStrip.jsx";
import Button from "../components/Button.jsx";
import Halo from "../components/Halo.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";

/**
 * Editorial landing. Three movements:
 *   1. Hero — kanji watermark, oversized wordmark, tagline + Japanese gloss
 *   2. Manifesto — drop-capped paragraph + three exhibition features
 *   3. Final CTA — "Open the vitrine" duotone close
 *
 * Authenticated users get a short greeting + quick-pick destinations and
 * their recent activity strip instead of the public marketing pitch.
 */
export default function LandingPage() {
  const t = useT();
  const me = useMe();
  const logout = useLogout();

  const authed = me.data?.authenticated;
  const user = me.data?.user;

  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* Top-right utility cluster */}
      <div className="absolute top-6 right-6 z-30 flex items-center gap-4">
        <LocaleSwitcher />
        {authed ? (
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="text-[10px] uppercase tracking-[0.25em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors disabled:opacity-50"
          >
            {t("nav.signout")}
          </button>
        ) : null}
      </div>

      {/* ──────────────────────────── HERO ──────────────────────────── */}
      <section className="relative min-h-[100dvh] grid place-items-center px-6 pt-24 pb-32">
        <Halo intensity={0.22} />

        {/* Kanji watermark — 飾 "decorate / ornament" */}
        <span
          aria-hidden
          className="kanji-mark text-[42vmin] md:text-[36vmin] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 drift reveal"
          style={{ "--i": 0, "--delay": "0ms" }}
        >
          飾
        </span>

        <div className="relative max-w-3xl text-center z-10">
          <p className="micro reveal" style={{ "--i": 1 }}>
            {t("app.phase")}
          </p>

          <h1
            className="display text-[18vw] sm:text-8xl md:text-9xl leading-[0.85] mt-6 text-[var(--color-ivoire)] reveal"
            style={{ "--i": 2 }}
          >
            FigureCollector
          </h1>

          <p
            className="ja text-base md:text-lg mt-6 text-[var(--color-or-pale)] tracking-[0.42em] reveal"
            style={{ "--i": 3 }}
          >
            {t("app.tagline_jp")}
          </p>

          <div
            className="ornate-rule mx-auto w-72 my-12 reveal"
            style={{ "--i": 4 }}
          >
            <span aria-hidden className="ornate-rule__diamond" />
          </div>

          <p
            className="display-italic text-2xl md:text-3xl text-[var(--color-or)] leading-snug reveal"
            style={{ "--i": 5 }}
          >
            {t("app.tagline_en")}
          </p>

          <div
            className="mt-12 flex flex-wrap gap-3 justify-center reveal"
            style={{ "--i": 6 }}
          >
            {authed ? (
              <AuthedActions t={t} userName={user.display_name} />
            ) : (
              <>
                <Link to="/login">
                  <Button variant="primary">{t("landing.cta_signin")}</Button>
                </Link>
                <Link to="/register">
                  <Button variant="ghost">{t("landing.cta_signup")}</Button>
                </Link>
              </>
            )}
          </div>

          {!authed ? (
            <p
              className="mt-10 text-xs text-[var(--color-ivoire-soft)]/70 max-w-md mx-auto reveal"
              style={{ "--i": 7 }}
            >
              {t("landing.bootstrap_note")}
            </p>
          ) : null}
        </div>

        {/* Scroll cue */}
        {!authed ? (
          <div
            aria-hidden
            className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 reveal"
            style={{ "--i": 8 }}
          >
            <span className="micro-tight">{t("landing.scroll")}</span>
            <span className="gold-rule-vertical h-10 opacity-60" />
          </div>
        ) : null}
      </section>

      {/* If authenticated, show recent activity below the hero */}
      {authed ? (
        <section className="relative max-w-4xl mx-auto px-6 pb-24">
          <header className="flex items-baseline justify-between mb-6">
            <p className="micro">{t("landing.recent_activity")}</p>
            <Link
              to="/activity"
              className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("landing.see_all")} →
            </Link>
          </header>
          <ActivityStrip limit={6} />
        </section>
      ) : (
        <>
          {/* ─────────────── MANIFESTO + DECORATIVE SHELVES ─────────────── */}
          <section className="relative max-w-6xl mx-auto px-6 py-24">
            <div className="grid md:grid-cols-[1.1fr_1fr] gap-12 lg:gap-20 items-center">
              <div>
                <p className="micro mb-4">{t("landing.manifesto.label")}</p>
                <h2 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] leading-[1.05]">
                  {t("landing.manifesto.title")}
                </h2>
                <div className="gold-rule w-24 my-8" />
                <p className="drop-cap text-base text-[var(--color-ivoire-soft)] leading-relaxed">
                  {t("landing.manifesto.body")}
                </p>
              </div>

              <div className="relative aspect-[3/4] hidden md:block">
                <Shelves />
              </div>
            </div>
          </section>

          {/* ─────────────── FEATURES ─────────────── */}
          <section className="relative max-w-6xl mx-auto px-6 py-20">
            <div className="ornate-rule mb-14 max-w-md mx-auto">
              <span aria-hidden className="ornate-rule__diamond" />
            </div>
            <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              <Feature
                kanji="蒐"
                label={t("landing.feat.collect.label")}
                title={t("landing.feat.collect.title")}
                body={t("landing.feat.collect.body")}
              />
              <Feature
                kanji="期"
                label={t("landing.feat.track.label")}
                title={t("landing.feat.track.title")}
                body={t("landing.feat.track.body")}
              />
              <Feature
                kanji="覧"
                label={t("landing.feat.share.label")}
                title={t("landing.feat.share.title")}
                body={t("landing.feat.share.body")}
              />
            </ul>
          </section>

          {/* ─────────────── FINAL CTA ─────────────── */}
          <section className="relative max-w-3xl mx-auto px-6 py-32 text-center">
            <p className="micro">{t("landing.final.label")}</p>
            <h2 className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95]">
              {t("landing.final.title")}
            </h2>
            <p className="ja text-base mt-5 text-[var(--color-or-pale)] tracking-[0.42em]">
              {t("landing.final.title_jp")}
            </p>
            <div className="gold-rule mx-auto w-32 my-10" />
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/register">
                <Button variant="primary">{t("landing.cta_signup")}</Button>
              </Link>
              <Link to="/login">
                <Button variant="ghost">{t("landing.cta_signin")}</Button>
              </Link>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AuthedActions({ t, userName }) {
  return (
    <div className="space-y-6">
      <p className="display text-2xl text-[var(--color-ivoire)]">
        {t("landing.greeting", { name: userName })}
      </p>
      <p className="micro">{t("landing.welcome_back")}</p>
      <div className="flex flex-wrap gap-3 justify-center mt-2">
        <Link to="/collection">
          <Button variant="primary">{t("nav.collection")}</Button>
        </Link>
        <Link to="/preorders">
          <Button variant="ghost">{t("nav.preorders")}</Button>
        </Link>
        <Link to={`/year-in-review/${new Date().getFullYear()}`}>
          <Button variant="ghost">{t("nav.year_in_review")}</Button>
        </Link>
      </div>
    </div>
  );
}

function Feature({ kanji, label, title, body }) {
  return (
    <li className="relative spotlight p-7 border border-[var(--color-or)]/15 bg-[var(--color-noir-soft)]/40 frame-corners card-lift overflow-hidden">
      <span
        aria-hidden
        className="ja text-[7rem] text-[var(--color-or)]/12 absolute -top-6 -right-2 leading-none select-none"
      >
        {kanji}
      </span>
      <p className="micro relative">{label}</p>
      <h3 className="display text-2xl mt-3 text-[var(--color-ivoire)] relative">
        {title}
      </h3>
      <div className="gold-rule w-12 my-5" />
      <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {body}
      </p>
    </li>
  );
}

function Shelves() {
  // Three stacked stylised "display shelves" with figurine silhouettes —
  // pure SVG so it stays crisp at any size and costs zero network.
  return (
    <svg
      viewBox="0 0 320 420"
      className="w-full h-full"
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id="shelfShadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-or)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--color-or)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect
        x="6" y="6" width="308" height="408"
        fill="none" stroke="var(--color-or)" strokeOpacity="0.25"
      />

      <text
        x="160" y="50"
        textAnchor="middle"
        fontFamily="Noto Serif JP, serif"
        fontSize="34"
        fill="var(--color-or)"
        fillOpacity="0.55"
        letterSpacing="0.3em"
      >
        飾棚
      </text>
      <line x1="100" y1="68" x2="220" y2="68" stroke="var(--color-or)" strokeOpacity="0.5" />

      {[110, 220, 330].map((y, i) => (
        <g key={i}>
          <line x1="20" y1={y} x2="300" y2={y} stroke="var(--color-or)" strokeOpacity="0.45" />
          <rect x="20" y={y} width="280" height="40" fill="url(#shelfShadow)" opacity="0.4" />
          <Figurine cx={70} baseY={y} variant="a" />
          <Figurine cx={160} baseY={y} variant={i === 1 ? "c" : "b"} />
          <Figurine cx={250} baseY={y} variant={i === 0 ? "b" : "a"} />
        </g>
      ))}
    </svg>
  );
}

function Figurine({ cx, baseY, variant }) {
  if (variant === "a") {
    return (
      <g stroke="var(--color-ivoire)" strokeOpacity="0.6" strokeWidth="1.2" fill="none">
        <ellipse cx={cx} cy={baseY - 2} rx="22" ry="3" fill="var(--color-or)" fillOpacity="0.2" stroke="none" />
        <circle cx={cx} cy={baseY - 38} r="11" />
        <path d={`M ${cx - 14} ${baseY - 8} Q ${cx} ${baseY - 30} ${cx + 14} ${baseY - 8} Z`} fillOpacity="0.05" fill="var(--color-or)" />
      </g>
    );
  }
  if (variant === "b") {
    return (
      <g stroke="var(--color-ivoire)" strokeOpacity="0.55" strokeWidth="1.2" fill="none">
        <ellipse cx={cx} cy={baseY - 2} rx="26" ry="3" fill="var(--color-or)" fillOpacity="0.2" stroke="none" />
        <circle cx={cx} cy={baseY - 44} r="9" />
        <path
          d={`M ${cx - 18} ${baseY - 4} L ${cx - 8} ${baseY - 34} L ${cx + 8} ${baseY - 34} L ${cx + 18} ${baseY - 4} Z`}
          fill="var(--color-laque)"
          fillOpacity="0.15"
        />
      </g>
    );
  }
  return (
    <g stroke="var(--color-or)" strokeOpacity="0.7" strokeWidth="1.2" fill="none">
      <ellipse cx={cx} cy={baseY - 2} rx="24" ry="3" fill="var(--color-or)" fillOpacity="0.25" stroke="none" />
      <circle cx={cx} cy={baseY - 52} r="10" />
      <path d={`M ${cx} ${baseY - 42} L ${cx} ${baseY - 4}`} />
      <path d={`M ${cx - 14} ${baseY - 18} L ${cx + 14} ${baseY - 18}`} />
    </g>
  );
}
