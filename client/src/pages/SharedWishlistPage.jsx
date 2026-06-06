import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useSharedWishlist,
  useReserveGift,
  useReleaseGift,
} from "../hooks/useGiftList.js";
import { useMe } from "../hooks/useMe.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { fmtMoney } from "../lib/money.js";

// Hanko red (朱) is Direction A's single hot accent — the gift list leans on it
// for the "reserve" CTAs and the claimed marker; gold stays for value/rules.
const LAQUE = "var(--color-laque)";
const LAQUE_BRIGHT = "var(--color-laque-bright)";

const coverFor = (it) =>
  it.catalog_cover_photo_id
    ? `/api/figure-photos/${it.catalog_cover_photo_id}`
    : it.figure_image || null;

// Giver-side state lives in localStorage (no account): which pieces *I* claimed
// (figure_id → secret reserver_token, needed to release) and my last-used name.
const mineKey = (token) => `fc_gift_${token}`;
const nameKey = (token) => `fc_gift_${token}_name`;
const readMine = (token) => {
  try {
    return JSON.parse(localStorage.getItem(mineKey(token)) || "{}");
  } catch {
    return {};
  }
};
const writeMine = (token, map) => {
  try {
    localStorage.setItem(mineKey(token), JSON.stringify(map));
  } catch {
    /* private mode / quota — claims still work this session, just not sticky */
  }
};
const recallName = (token) => {
  try {
    return localStorage.getItem(nameKey(token)) || "";
  } catch {
    return "";
  }
};

// Anonymous "reveal sensitive content" comfort pref — global across any gift
// link the viewer opens. Signed-in viewers are governed by their own NSFW
// setting instead, server-side.
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
 * Public, anonymous gift list at `/g/<token>` — the first SPA route that
 * renders without a session (no AppShell, no login redirect). Friends see the
 * owner's wishlist and who has already claimed what (anti-duplicate), and can
 * claim a piece by typing a name. The owner, if they open their own link, sees
 * a banner and no reservations — the surprise stays intact.
 *
 * Direction A — "Shōjo-Noir" share page. Editorial treatment worthy of a
 * public link: a brand/editorial header (kicker → AccentTitle headline →
 * gold-rule → owner tagline), the wished pieces in the refined FigureCard
 * grid, and anonymous "reserve this gift" actions as red hanko pills. A faint
 * 願 ("wish") watermark + a seigaiha foot carry the mood; gold is reserved for
 * value, hanko red for the claim CTAs.
 */
export default function SharedWishlistPage() {
  const { token } = useParams();
  const t = useT();
  const locale = document.documentElement.lang || undefined;

  const me = useMe();
  const authed = !!me.data?.authenticated;
  const viewerNsfw = me.data?.user?.nsfw_visibility; // "hide" | "blur" | "show" | undefined
  const [anonReveal, setAnonReveal] = useState(() => readNsfwReveal());
  // The ?nsfw flag only drives anonymous viewers; signed-in ones are gated by
  // their own setting server-side.
  const revealNsfw = !authed && anonReveal;
  const blurNsfw = authed && viewerNsfw === "blur";

  const list = useSharedWishlist(token, revealNsfw);
  const reserve = useReserveGift(token);
  const release = useReleaseGift(token);

  const [mine, setMine] = useState(() => readMine(token));
  const [openId, setOpenId] = useState(null); // figure whose claim form is open
  const [name, setName] = useState(() => recallName(token));

  const toggleNsfw = () => {
    const v = !anonReveal;
    setAnonReveal(v);
    writeNsfwReveal(v);
  };

  const doReserve = (figureId) => {
    const nm = name.trim();
    if (!nm) return;
    reserve.mutate(
      { figure_id: figureId, reserver_name: nm },
      {
        onSuccess: (res) => {
          const next = { ...mine, [figureId]: res.reserver_token };
          setMine(next);
          writeMine(token, next);
          try {
            localStorage.setItem(nameKey(token), nm);
          } catch { /* ignore */ }
          setOpenId(null);
        },
      },
    );
  };

  const doRelease = (figureId) => {
    const tok = mine[figureId];
    if (!tok) return;
    release.mutate(
      { figure_id: figureId, reserver_token: tok },
      {
        onSuccess: () => {
          const next = { ...mine };
          delete next[figureId];
          setMine(next);
          writeMine(token, next);
        },
      },
    );
  };

  if (list.isLoading) {
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
  if (list.isError || !list.data) {
    return (
      <Shell t={t}>
        <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
          <span
            aria-hidden
            className="ja absolute -top-8 -right-6 text-[13rem] leading-none select-none pointer-events-none"
            style={{ color: `color-mix(in oklab, ${LAQUE} 14%, transparent)` }}
          >
            願
          </span>
          <p className="micro relative" style={{ color: LAQUE_BRIGHT }}>
            {t("giftlist.notfound_eyebrow", { default: "Lien introuvable" })}
          </p>
          <p className="mt-4 text-[var(--color-ivoire-soft)] italic relative leading-relaxed">
            {t("gift.not_found")}
          </p>
          <div className="gold-rule mx-auto w-20 mt-8" />
        </Card>
      </Shell>
    );
  }

  const { owner_name, is_owner, owner_allows_nsfw, hidden_nsfw, items } = list.data;
  const claimedCount = items.filter((it) => it.reserved).length;
  const showNsfwControl = owner_allows_nsfw && (hidden_nsfw > 0 || (!authed && anonReveal));

  return (
    <Shell t={t}>
      {/* ─── Editorial header ─── */}
      <header className="relative mb-12">
        <span
          aria-hidden
          className="kanji-mark text-[22rem] -top-28 -right-6 hidden md:block select-none"
        >
          願
        </span>

        <Reveal>
          <p className="micro flex items-center gap-2.5">
            <span
              aria-hidden
              className="w-1 h-1 rotate-45"
              style={{ background: LAQUE_BRIGHT }}
            />
            {t("giftlist.kicker", { default: "OFFRIR · 願 · LISTE DE SOUHAITS" })}
          </p>
          <h1 className="display text-5xl md:text-6xl mt-3 leading-[0.95] text-[var(--color-ivoire)]">
            <AccentTitle text={t("gift.public_title", { name: owner_name })} />
          </h1>
          <div className="gold-rule w-24 mt-6" />
          <p className="mt-6 text-[var(--color-ivoire-soft)] text-lg leading-relaxed max-w-2xl">
            {is_owner ? t("gift.owner_banner") : t("gift.public_body")}
          </p>
          <p
            className="ja mt-5 tracking-[0.4em] text-sm"
            style={{ color: "color-mix(in oklab, var(--color-or-pale) 80%, transparent)" }}
          >
            {t("giftlist.tagline_jp", { default: "願 い の 棚" })}
          </p>
        </Reveal>

        {/* Glanceable claimed meter — gold "value", not a manga completion %. */}
        {!is_owner && items.length > 0 ? (
          <Reveal delay={0.08}>
            <div className="mt-8 flex items-center gap-4 max-w-md">
              <span className="micro-tight whitespace-nowrap">
                {t("gift.claimed_count", { n: claimedCount, total: items.length })}
              </span>
              <span
                className="relative flex-1 h-px"
                style={{ background: "color-mix(in oklab, var(--color-or) 22%, transparent)" }}
                aria-hidden
              >
                <span
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: `${items.length ? (claimedCount / items.length) * 100 : 0}%`,
                    background: LAQUE_BRIGHT,
                  }}
                />
              </span>
              <span className="figural text-sm text-[var(--color-or-pale)] tabular-nums">
                {claimedCount}/{items.length}
              </span>
            </div>
          </Reveal>
        ) : null}

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
              <GiftItem
                it={it}
                t={t}
                locale={locale}
                blurNsfw={blurNsfw}
                isOwner={is_owner}
                isMine={!!mine[it.figure_id]}
                opening={openId === it.figure_id}
                name={name}
                setName={setName}
                reserving={reserve.isPending}
                releasing={release.isPending}
                onOpen={() => {
                  setOpenId(it.figure_id);
                  setName(recallName(token));
                }}
                onClose={() => setOpenId(null)}
                onReserve={() => doReserve(it.figure_id)}
                onRelease={() => doRelease(it.figure_id)}
              />
            </Reveal>
          ))}
        </ul>
      )}

      {reserve.isError ? (
        <p
          role="alert"
          className="mt-6 text-[12px] tracking-wide border-l-2 pl-3 py-1"
          style={{ color: LAQUE_BRIGHT, borderColor: LAQUE_BRIGHT }}
        >
          {t("gift.reserve_error")}
        </p>
      ) : null}
    </Shell>
  );
}

/**
 * One wished piece — the refined FigureCard with a gift action tray beneath it.
 * The tray carries the anonymity rule: owners see only "your wish" and never
 * who reserved; givers get a red hanko pill that opens an inline name field,
 * or the claimed marker (with a quiet release link if the claim is theirs).
 */
function GiftItem({
  it,
  t,
  locale,
  blurNsfw,
  isOwner,
  isMine,
  opening,
  name,
  setName,
  reserving,
  releasing,
  onOpen,
  onClose,
  onReserve,
  onRelease,
}) {
  const priced = it.max_price_amount != null;
  // Reserved pieces wear the museum stamp; the owner never sees the marker
  // (their tray says "your wish" instead, so the surprise holds).
  const badge =
    it.reserved && !isOwner
      ? {
          label: isMine
            ? t("gift.reserved_mine")
            : t("gift.reserved_by", { name: it.reserved_by || "—" }),
          tone: "preorder",
        }
      : null;

  return (
    <div className={`h-full flex flex-col ${it.reserved && !isMine ? "opacity-85" : ""}`}>
      <FigureCard
        figureId={it.figure_id}
        name={it.figure_name}
        type={it.figure_type}
        manufacturer={it.manufacturer_name}
        imageUrl={coverFor(it)}
        scale={it.scale}
        versionName={it.version_name}
        wished={!it.reserved && !isOwner}
        badge={badge}
        blurImage={it.is_nsfw && blurNsfw}
      />

      {/* Gift action tray — mirrors CollectionPage's per-card meta row. */}
      <div className="mt-3 px-1 min-h-[2.25rem] flex items-center justify-between gap-3">
        {priced ? (
          <span className="micro-tight figural text-[var(--color-or-pale)]">
            {t("gift.target", {
              p: fmtMoney(it.max_price_amount, it.max_price_currency || "EUR", locale),
            })}
          </span>
        ) : (
          <span className="micro-tight text-[var(--color-ivoire-soft)]/60">
            {t(`type.${it.figure_type}`)}
          </span>
        )}

        {it.reserved ? (
          isMine ? (
            <button
              type="button"
              onClick={onRelease}
              disabled={releasing}
              className="tap-target text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] transition-colors hover:text-[var(--color-laque-bright)] disabled:opacity-50"
            >
              {t("gift.release")}
            </button>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]"
              style={{ color: LAQUE_BRIGHT }}
            >
              <span aria-hidden>✓</span>
              {t("giftlist.taken", { default: "Réservé" })}
            </span>
          )
        ) : isOwner ? (
          <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)] italic">
            {t("gift.owner_item_hint")}
          </span>
        ) : opening ? null : (
          <Button
            variant="primary"
            onClick={onOpen}
            className="!px-4 !py-1.5 text-[11px]"
          >
            {t("gift.reserve")}
          </Button>
        )}
      </div>

      {/* Inline claim form — kept outside the row so it can breathe full-width. */}
      {!it.reserved && !isOwner && opening ? (
        <div className="mt-2 px-1 flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onReserve();
              if (e.key === "Escape") onClose();
            }}
            placeholder={t("gift.name_ph")}
            aria-label={t("gift.name_ph")}
            maxLength={60}
            className="flex-1 min-w-0 bg-[var(--color-noir)] text-[var(--color-ivoire)] text-[12px] px-2.5 py-2 outline-none transition-colors"
            style={{
              border: "1px solid color-mix(in oklab, var(--color-or) 30%, transparent)",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--color-or)")}
            onBlur={(e) =>
              (e.target.style.borderColor =
                "color-mix(in oklab, var(--color-or) 30%, transparent)")
            }
          />
          <button
            type="button"
            onClick={onReserve}
            disabled={reserving || !name.trim()}
            className="tap-target shrink-0 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire)] rounded-full transition-colors disabled:opacity-50"
            style={{ background: LAQUE }}
          >
            {t("gift.confirm")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="tap-target shrink-0 w-9 grid place-items-center text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)] transition-colors"
            aria-label={t("editor.cancel")}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Empty wishlist — an editorial Card with the 願 watermark + a calm note. */
function EmptyState({ t }) {
  return (
    <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none pointer-events-none"
      >
        願
      </span>
      <p className="micro relative">
        {t("giftlist.empty_eyebrow", { default: "Liste vide" })}
      </p>
      <p className="mt-4 text-[var(--color-ivoire-soft)] italic relative leading-relaxed">
        {t("gift.empty")}
      </p>
      <div className="gold-rule mx-auto w-20 mt-8" />
    </Card>
  );
}

/**
 * Minimal standalone chrome — a refined editorial frame (wordmark, locale
 * switcher, seigaiha foot), no app nav. Rendered without AppShell, like Login,
 * because the page must work for anonymous visitors with no session.
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
              {t("gift.public_eyebrow")}
            </span>
            <LocaleSwitcher />
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-14 md:py-20">
        {children}
      </main>

      {/* Seigaiha wave veil at the foot — quiet, mask-faded (GPU-light). */}
      <div
        aria-hidden
        className="seigaiha pointer-events-none absolute inset-x-0 bottom-0 h-28 opacity-50"
        style={{
          maskImage: "linear-gradient(transparent, #000)",
          WebkitMaskImage: "linear-gradient(transparent, #000)",
        }}
      />
    </div>
  );
}
