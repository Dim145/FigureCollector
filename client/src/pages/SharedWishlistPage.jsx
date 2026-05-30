import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useSharedWishlist,
  useReserveGift,
  useReleaseGift,
} from "../hooks/useGiftList.js";
import { useMe } from "../hooks/useMe.js";
import { typeHue } from "../lib/typeHue.js";
import { fmtMoney } from "../lib/money.js";

const MAGENTA = "var(--color-neon-magenta)";

const TYPE_KANJI = {
  nendoroid: "童", scale: "像", figma: "動", prize: "賞", trading: "交",
  statue: "彫", plamo: "組", bishoujo: "美", dakimakura: "枕", other: "玩",
};
const typeKanji = (ty) => TYPE_KANJI[ty] || "玩";
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
        <p className="text-center text-[var(--color-ivoire-soft)] py-24">…</p>
      </Shell>
    );
  }
  if (list.isError || !list.data) {
    return (
      <Shell t={t}>
        <div className="text-center py-24">
          <p className="ja text-[6rem] leading-none" style={{ color: `color-mix(in oklab, ${MAGENTA} 35%, transparent)` }}>
            贈
          </p>
          <p className="mt-3 text-[var(--color-ivoire-soft)] italic">{t("gift.not_found")}</p>
        </div>
      </Shell>
    );
  }

  const { owner_name, is_owner, owner_allows_nsfw, hidden_nsfw, items } = list.data;
  const claimedCount = items.filter((it) => it.reserved).length;
  const showNsfwControl = owner_allows_nsfw && (hidden_nsfw > 0 || (!authed && anonReveal));

  return (
    <Shell t={t}>
      <header className="relative mb-9">
        <span aria-hidden className="kanji-mark text-[20rem] -top-24 -right-4 hidden md:block">贈</span>
        <p className="micro" style={{ color: MAGENTA }}>{t("gift.public_eyebrow")}</p>
        <h1 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] mt-2">
          {t("gift.public_title", { name: owner_name })}
        </h1>
        <div className="gold-rule w-16 mt-4" style={{ background: MAGENTA }} />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {is_owner ? t("gift.owner_banner") : t("gift.public_body")}
        </p>
        {!is_owner && items.length > 0 ? (
          <p className="mt-2 font-mono text-[11px] text-[var(--color-ivoire-soft)]">
            {t("gift.claimed_count", { n: claimedCount, total: items.length })}
          </p>
        ) : null}
        {showNsfwControl ? (
          !authed ? (
            <button
              type="button"
              onClick={toggleNsfw}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] border border-[color-mix(in_oklab,var(--color-laque)_45%,transparent)] text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)] transition-colors"
            >
              {anonReveal ? t("gift.nsfw_hide") : t("gift.nsfw_reveal", { n: hidden_nsfw })}
            </button>
          ) : hidden_nsfw > 0 ? (
            <p className="mt-3 text-[11px] text-[var(--color-ivoire-soft)] italic">
              {t("gift.nsfw_hidden_note", { n: hidden_nsfw })}
            </p>
          ) : null
        ) : null}
      </header>

      {items.length === 0 ? (
        <p className="text-center text-[var(--color-ivoire-soft)] italic py-16">{t("gift.empty")}</p>
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
          {items.map((it) => {
            const hue = typeHue(it.figure_type);
            const cover = coverFor(it);
            const isMine = !!mine[it.figure_id];
            const opening = openId === it.figure_id;
            return (
              <li
                key={it.figure_id}
                className={`flex gap-3 p-3 bg-[var(--color-noir-soft)] border ${
                  it.reserved ? "opacity-80" : ""
                }`}
                style={{ borderColor: "color-mix(in oklab, var(--color-or) 16%, transparent)" }}
              >
                {/* thumbnail */}
                <div
                  className="relative shrink-0 w-[64px] h-[80px] grid place-items-center overflow-hidden"
                  style={{ background: "var(--color-noir-deep)", border: `1px solid color-mix(in oklab, ${hue} 22%, transparent)` }}
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      className={`absolute inset-0 w-full h-full object-cover ${it.is_nsfw && blurNsfw ? "nsfw-blur" : ""}`}
                    />
                  ) : (
                    <span aria-hidden className="ja text-[2rem]" style={{ color: `color-mix(in oklab, ${hue} 50%, transparent)` }}>
                      {typeKanji(it.figure_type)}
                    </span>
                  )}
                </div>

                {/* body */}
                <div className="flex-1 min-w-0 flex flex-col">
                  <h3 className="display text-lg text-[var(--color-ivoire)] leading-tight line-clamp-2">{it.figure_name}</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--color-ivoire-soft)] truncate">
                    {it.manufacturer_name || t(`type.${it.figure_type}`)}
                    {it.max_price_amount != null ? (
                      <span className="font-mono">
                        {" · "}
                        {t("gift.target", { p: fmtMoney(it.max_price_amount, it.max_price_currency || "EUR", locale) })}
                      </span>
                    ) : null}
                  </p>

                  {/* action zone */}
                  <div className="mt-auto pt-2.5">
                    {it.reserved ? (
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] px-2 py-1"
                          style={{
                            color: MAGENTA,
                            border: `1px solid color-mix(in oklab, ${MAGENTA} 45%, transparent)`,
                            background: `color-mix(in oklab, ${MAGENTA} 10%, transparent)`,
                          }}
                        >
                          ✓ {isMine ? t("gift.reserved_mine") : t("gift.reserved_by", { name: it.reserved_by || "—" })}
                        </span>
                        {isMine ? (
                          <button
                            type="button"
                            onClick={() => doRelease(it.figure_id)}
                            disabled={release.isPending}
                            className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
                          >
                            {t("gift.release")}
                          </button>
                        ) : null}
                      </div>
                    ) : is_owner ? (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ivoire-soft)] italic">
                        {t("gift.owner_item_hint")}
                      </span>
                    ) : opening ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && doReserve(it.figure_id)}
                          placeholder={t("gift.name_ph")}
                          maxLength={60}
                          className="flex-1 min-w-0 bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire)] text-[12px] px-2 py-1.5 outline-none focus:border-[var(--color-or)]"
                        />
                        <button
                          type="button"
                          onClick={() => doReserve(it.figure_id)}
                          disabled={reserve.isPending || !name.trim()}
                          className="shrink-0 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-[var(--color-ivoire)] disabled:opacity-50"
                          style={{ background: MAGENTA }}
                        >
                          {t("gift.confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenId(null)}
                          className="shrink-0 w-7 grid place-items-center text-[var(--color-ivoire-soft)]"
                          aria-label={t("editor.cancel")}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenId(it.figure_id);
                          setName(recallName(token));
                        }}
                        className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire)] transition-opacity hover:opacity-90"
                        style={{ background: MAGENTA }}
                      >
                        {t("gift.reserve")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {reserve.isError ? (
        <p className="mt-4 text-[12px] text-[var(--color-laque-bright)]">{t("gift.reserve_error")}</p>
      ) : null}
    </Shell>
  );
}

/** Minimal standalone chrome — wordmark + footer, no app nav (anonymous page). */
function Shell({ t, children }) {
  return (
    <div className="min-h-screen bg-[var(--color-noir)]">
      <div className="border-b border-[color-mix(in_oklab,var(--color-or)_14%,transparent)]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-[var(--color-ivoire)]">
            <span aria-hidden className="ja text-xl text-[var(--color-or)]">像</span>
            <span className="display text-lg">FigureCollector</span>
          </Link>
          <span className="micro text-[var(--color-ivoire-soft)]">{t("gift.public_eyebrow")}</span>
        </div>
      </div>
      <main className="relative max-w-5xl mx-auto px-6 py-14">{children}</main>
    </div>
  );
}
