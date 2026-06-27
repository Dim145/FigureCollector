import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useT } from "../../i18n/index.jsx";
import { useMe } from "../../hooks/useMe.js";
import { usePublicCabinet } from "../../hooks/useCollection.js";
import AccentTitle from "../../components/AccentTitle.jsx";
import Card from "../../components/Card.jsx";
import FigureCard from "../../components/FigureCard.jsx";
import LocaleSwitcher from "../../components/LocaleSwitcher.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { resolveOwnedCover } from "../../lib/coverUrl.js";

// Direction-A accents: gold (or) reads "shelf/value", hanko red (laque) is the
// single hot accent for the "lien introuvable" state.
const LAQUE = "var(--color-laque)";
const LAQUE_BRIGHT = "var(--color-laque-bright)";

// Anonymous "reveal sensitive content" comfort pref — shared with the gift
// link so a viewer's choice carries across either public surface. Signed-in
// viewers are governed by their own NSFW setting server-side instead.
const NSFW_PREF = "fc_gift_nsfw";
const readNsfwReveal = () => {
  try {
    return localStorage.getItem(NSFW_PREF) === "1";
  } catch {
    return false;
  }
};
const writeNsfwReveal = (on) => {
  try {
    localStorage.setItem(NSFW_PREF, on ? "1" : "0");
  } catch {
    /* ignore */
  }
};

/**
 * Public, anonymous display cabinet at `/v/<token>` — a read-only window onto
 * one of an owner's vitrines. No AppShell, no login redirect, no edit, no
 * reservation: visitors just browse the pieces. Mirrors the gift list's public
 * page (SharedWishlistPage) in chrome + Direction-A treatment, but without any
 * write affordance. NSFW / monetary value gating is enforced server-side from
 * the owner's public-profile switches; this page only renders what it receives.
 */
export default function PublicCabinet() {
  const { token } = useParams();
  const t = useT();

  const me = useMe();
  const authed = !!me.data?.authenticated;
  const viewerNsfw = me.data?.user?.nsfw_visibility; // "hide" | "blur" | "show" | undefined
  const [anonReveal, setAnonReveal] = useState(() => readNsfwReveal());
  // The ?nsfw flag only drives anonymous viewers; signed-in ones are gated by
  // their own setting server-side.
  const revealNsfw = !authed && anonReveal;
  const blurNsfw = authed && viewerNsfw === "blur";

  const cab = usePublicCabinet(token, revealNsfw);

  const toggleNsfw = () => {
    const v = !anonReveal;
    setAnonReveal(v);
    writeNsfwReveal(v);
  };

  if (cab.isLoading) {
    return (
      <Shell t={t}>
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-28 text-2xl"
        >
          …
        </p>
      </Shell>
    );
  }
  if (cab.isError || !cab.data) {
    return (
      <Shell t={t}>
        <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-8 -right-6 text-[13rem] leading-none select-none pointer-events-none"
            style={{ color: `color-mix(in oklab, ${LAQUE} 14%, transparent)` }}
          >
            棚
          </span>
          <p className="micro relative" style={{ color: LAQUE_BRIGHT }}>
            {t("vshare.notfound_eyebrow", { default: "Lien introuvable" })}
          </p>
          <p className="mt-4 text-[var(--color-ivoire-soft)] italic relative leading-relaxed">
            {t("vshare.not_found")}
          </p>
          <div className="gold-rule mx-auto w-20 mt-8" />
        </Card>
      </Shell>
    );
  }

  const { cabinet_name, owner_name, is_owner, owner_allows_nsfw, hidden_nsfw, items } = cab.data;
  const showNsfwControl = owner_allows_nsfw && (hidden_nsfw > 0 || (!authed && anonReveal));

  return (
    <Shell t={t}>
      {/* ─── Editorial header ─── */}
      <header className="relative mb-12">
        <span
          aria-hidden
          className="kanji-mark text-[22rem] -top-28 -right-6 hidden md:block select-none"
        >
          棚
        </span>

        <Reveal>
          <p className="micro flex items-center gap-2.5">
            <span aria-hidden className="w-1 h-1 rotate-45" style={{ background: "var(--color-or)" }} />
            {t("vshare.public_kicker", { default: "COLLECTION · 棚 · VITRINE" })}
          </p>
          <h1 className="display text-5xl md:text-6xl mt-3 leading-[0.95] text-[var(--color-ivoire)]">
            <AccentTitle text={cabinet_name} />
          </h1>
          <div className="gold-rule w-24 mt-6" />
          <p className="mt-6 text-[var(--color-ivoire-soft)] text-lg leading-relaxed max-w-2xl">
            {is_owner
              ? t("vshare.owner_banner")
              : t("vshare.public_body", { name: owner_name })}
          </p>
          <p
            className="ja mt-5 tracking-[0.4em] text-sm"
            style={{ color: "color-mix(in oklab, var(--color-or-pale) 80%, transparent)" }}
          >
            {t("vshare.tagline_jp", { default: "飾 り 棚" })}
          </p>
        </Reveal>

        {/* NSFW comfort control — anonymous toggle vs. signed-in note. */}
        {showNsfwControl ? (
          !authed ? (
            <button
              type="button"
              onClick={toggleNsfw}
              className="tap-target mt-6 inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors hover:opacity-90"
              style={{
                color: LAQUE_BRIGHT,
                border: `1px solid color-mix(in oklab, ${LAQUE} 45%, transparent)`,
              }}
            >
              {anonReveal ? t("gift.nsfw_hide") : t("gift.nsfw_reveal", { n: hidden_nsfw })}
            </button>
          ) : hidden_nsfw > 0 ? (
            <p className="mt-6 text-[11px] text-[var(--color-ivoire-soft)] italic">
              {t("gift.nsfw_hidden_note", { n: hidden_nsfw })}
            </p>
          ) : null
        ) : null}
      </header>

      {/* ─── Empty / grid ─── */}
      {items.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {items.map((it, i) => (
            <Reveal as="li" key={it.figure_id} delay={Math.min(i, 7) * 0.05} y={24}>
              {/* Read-only: no `href`, so the card never navigates into the
                  private app — anonymous visitors just look. */}
              <FigureCard
                figureId={it.figure_id}
                name={it.figure_name}
                type={it.figure_type}
                manufacturer={it.manufacturer_name}
                imageUrl={resolveOwnedCover(it)}
                imageFallback={it.figure_image || null}
                scale={it.scale}
                versionName={it.version_name}
                badge={
                  it.for_sale
                    ? { label: t("vshare.for_sale", { default: "À vendre" }), tone: "preorder" }
                    : it.for_trade
                      ? { label: t("vshare.for_trade", { default: "À échanger" }), tone: "preorder" }
                      : null
                }
                blurImage={it.is_nsfw && blurNsfw}
              />
            </Reveal>
          ))}
        </ul>
      )}
    </Shell>
  );
}

/** Empty cabinet — an editorial Card with the 棚 watermark + a calm note. */
function EmptyState({ t }) {
  return (
    <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none pointer-events-none"
      >
        棚
      </span>
      <p className="micro relative">{t("vshare.empty_eyebrow", { default: "Vitrine vide" })}</p>
      <p className="mt-4 text-[var(--color-ivoire-soft)] italic relative leading-relaxed">
        {t("vshare.empty")}
      </p>
      <div className="gold-rule mx-auto w-20 mt-8" />
    </Card>
  );
}

/**
 * Minimal standalone chrome — a refined editorial frame (wordmark, locale
 * switcher), no app nav. Rendered without AppShell, like the gift page, because
 * the page must work for anonymous visitors with no session.
 */
function Shell({ t, children }) {
  return (
    <div className="min-h-dvh relative overflow-hidden bg-[var(--color-noir)]">
      <header
        className="relative z-10 border-b"
        style={{ borderColor: "color-mix(in oklab, var(--color-or) 14%, transparent)" }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="group inline-flex items-baseline gap-2.5 text-[var(--color-ivoire)]"
            aria-label="FigureCollector — accueil"
          >
            <span className="ja text-xl text-[var(--color-or)] leading-none transition-transform duration-500 group-hover:rotate-[6deg]">
              像
            </span>
            <span className="display text-lg group-hover:text-[var(--color-or-pale)] transition-colors">
              FigureCollector
            </span>
          </Link>
          <div className="flex items-center gap-5">
            <span className="micro text-[var(--color-ivoire-soft)] hidden sm:inline">
              {t("vshare.public_eyebrow", { default: "Une vitrine partagée" })}
            </span>
            <LocaleSwitcher />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-14 md:py-20">{children}</main>
    </div>
  );
}
