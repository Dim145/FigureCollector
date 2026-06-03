import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { usePublicProfile } from "../hooks/useProfile.js";
import { fmtMoney } from "../lib/money.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Button from "../components/Button.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import FollowButton from "../components/FollowButton.jsx";
import FollowListModal from "../components/FollowListModal.jsx";

export default function PublicProfilePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const profile = usePublicProfile(slug);
  const [list, setList] = useState(null);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (profile.isLoading) return <AppShell><Loading /></AppShell>;
  if (profile.error || !profile.data)
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("profile.private")}</p>
        </main>
      </AppShell>
    );

  const { user, stats, collection, social, value } = profile.data;
  const isSelf = social?.is_self ?? me.data?.user?.username === user.username;
  const locale = me.data?.user?.locale;
  const dominantValue = value && value.length ? value[0] : null;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Localized hero colour-wash — a welcoming, gallery-like glow over the
            global aurora. Jade + gold + a magenta accent, low alpha, theme-aware
            via accent vars. Breathes gently (GPU opacity/scale) unless reduced. */}
        <HeroWash />

        <header className="relative mb-12 text-center">
          <span
            aria-hidden
            className="kanji-mark text-[20rem] sm:text-[26rem] -top-24 sm:-top-32 left-1/2 -translate-x-1/2 select-none"
          >
            蒐
          </span>

          <Reveal as="div" className="relative" y={20}>
            <p className="micro">
              {t("profile.member_since", { date: new Date(user.member_since).toLocaleDateString() })}
            </p>
            <h1 className="display text-4xl sm:text-5xl md:text-6xl mt-2 text-[var(--color-ivoire)] leading-[0.98]">
              {t("profile.public_title", { name: user.display_name })}
            </h1>
            <p
              className="ja text-base mt-3 tracking-[0.3em]"
              style={{
                color: "var(--color-or-pale)",
                textShadow:
                  "0 0 24px color-mix(in oklab, var(--color-or) 45%, transparent)",
              }}
            >
              @{user.username}
              {social?.follows_viewer ? (
                <span className="fc-chip fc-chip--jade ml-3 align-middle tracking-[0.12em]">
                  {t("follow.follows_you")}
                </span>
              ) : null}
            </p>
            <div className="gold-rule mx-auto w-32 mt-6" />
          </Reveal>

          <Reveal as="div" delay={0.08} y={18} className="relative mt-8 flex justify-center items-center gap-6 sm:gap-10 flex-wrap">
            <Stat label={t("profile.stat_pieces")} value={stats.pieces} accent="var(--color-or)" />
            <Stat label={t("profile.stat_series")} value={stats.series_count} accent="var(--color-jade)" />
            <Stat
              label={t("profile.stat_manufacturers")}
              value={stats.manufacturers_count}
              accent="var(--color-neon-magenta)"
            />
            <span
              aria-hidden
              className="hidden sm:block w-px h-10"
              style={{
                background:
                  "linear-gradient(to bottom,transparent,color-mix(in oklab,var(--color-or) 40%,transparent),transparent)",
              }}
            />
            <CountButton
              value={social?.followers ?? 0}
              label={t("profile.stat_followers")}
              onClick={() => setList({ tab: "followers" })}
            />
            <CountButton
              value={social?.following ?? 0}
              label={t("profile.stat_following")}
              onClick={() => setList({ tab: "following" })}
            />
          </Reveal>

          {dominantValue ? (
            <Reveal as="p" delay={0.1} className="relative mt-5 micro-tight">
              {t("profile.value_label")} ·{" "}
              <span className="text-[var(--color-or-pale)]">
                {fmtMoney(Math.round(Number(dominantValue.amount)), dominantValue.currency, locale)}
                {value.length > 1 ? " …" : ""}
              </span>
            </Reveal>
          ) : null}

          {!isSelf ? (
            <Reveal as="div" delay={0.14} y={16} className="relative mt-8 flex justify-center items-center gap-3">
              <FollowButton username={user.username} isFollowing={social?.is_following} />
              <Link to={`/compare/${user.username}`}>
                <Button variant="ghost">{t("compare.title", { name: user.display_name })}</Button>
              </Link>
            </Reveal>
          ) : null}
        </header>

        {collection.length === 0 ? (
          <p className="relative text-center text-[var(--color-ivoire-soft)] py-12">
            {t("collection.empty.title")}
          </p>
        ) : (
          <ul className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collection.map((entry, i) => (
              <Reveal as="li" key={entry.owned_id} delay={Math.min(i, 7) * 0.05} y={24}>
                <FigureCard
                  figureId={entry.figure_id}
                  href={`/figures/${entry.figure_id}`}
                  name={entry.figure_name}
                  type={entry.figure_type}
                  manufacturer={entry.manufacturer_name}
                  imageUrl={entry.figure_image}
                  scale={entry.scale}
                  versionName={entry.version_name}
                />
              </Reveal>
            ))}
          </ul>
        )}
        <FollowListModal
          open={!!list}
          slug={user.username}
          initialTab={list?.tab ?? "followers"}
          counts={{ followers: social?.followers ?? 0, following: social?.following ?? 0 }}
          onClose={() => setList(null)}
        />
      </main>
    </AppShell>
  );
}

/** color-mix helper — keep accent translucency in oklab, theme-var safe. */
function mix(accentVar, pct) {
  return `color-mix(in oklab, ${accentVar} ${pct}%, transparent)`;
}

/**
 * Localized hero colour-wash for the public profile — a warm, gallery-like
 * trio of radial gradients pinned behind the header. Self-contained inline
 * styles (no shared CSS). Static under prefers-reduced-motion; otherwise a
 * slow GPU-only opacity/scale breathe.
 */
function HeroWash() {
  // Static glow — no breathe (ambient motion removed for GPU). Edges feathered
  // so the gradients fade instead of hard-cutting at the content column.
  const wrap = {
    position: "absolute",
    top: "-3rem",
    left: "-3rem",
    right: "-3rem",
    height: "52vh",
    pointerEvents: "none",
    zIndex: 0,
    WebkitMaskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
    maskImage:
      "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
  };
  const base = { position: "absolute", inset: 0 };
  const layerA = {
    background: `radial-gradient(52% 68% at 22% 4%, ${mix("var(--color-jade)", 20)}, transparent 70%)`,
  };
  const layerB = {
    background: `radial-gradient(50% 64% at 84% 0%, ${mix("var(--color-or)", 22)}, transparent 72%)`,
  };
  const layerC = {
    background: `radial-gradient(44% 58% at 56% 34%, ${mix("var(--color-neon-magenta)", 10)}, transparent 75%)`,
  };
  return (
    <div aria-hidden style={wrap}>
      <span style={{ ...base, ...layerA, opacity: 0.85 }} />
      <span style={{ ...base, ...layerB, opacity: 0.85 }} />
      <span style={{ ...base, ...layerC, opacity: 0.85 }} />
    </div>
  );
}

function Stat({ label, value, accent = "var(--color-or)" }) {
  return (
    <div className="text-center">
      <p
        className="display text-3xl sm:text-4xl"
        style={{
          color: accent,
          textShadow: `0 0 28px ${`color-mix(in oklab, ${accent} 38%, transparent)`}`,
        }}
      >
        {value}
      </p>
      <p className="micro mt-1">{label}</p>
    </div>
  );
}

/** Clickable social counter — opens the followers / following list modal. */
function CountButton({ value, label, onClick }) {
  return (
    <button type="button" onClick={onClick} className="text-center group">
      <p className="display text-3xl sm:text-4xl text-[var(--color-or-pale)] transition-colors group-hover:text-[var(--color-ivoire)]">
        {value}
      </p>
      <p className="micro mt-1">{label}</p>
    </button>
  );
}

function Loading() {
  return <div className="max-w-md mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)]">…</div>;
}
