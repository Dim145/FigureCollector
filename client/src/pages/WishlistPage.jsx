import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useWishlistItems, usePatchWishlistItem, useRemoveWishlistItem } from "../hooks/useWishlist.js";
import { useAddOwnedItem } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { typeHue } from "../lib/typeHue.js";
import { fmtMoney } from "../lib/money.js";

const TYPE_KANJI = {
  nendoroid: "童", scale: "像", figma: "動", prize: "賞", trading: "交",
  statue: "彫", plamo: "組", bishoujo: "美", dakimakura: "枕", other: "玩",
};
const typeKanji = (t) => TYPE_KANJI[t] || "玩";
const coverFor = (it) =>
  it.catalog_cover_photo_id ? `/api/figure-photos/${it.catalog_cover_photo_id}` : it.figure_image || null;

/**
 * « Souhaits » — the wishlist: catalogue figures the user covets, each with an
 * optional target price ("cible") + note. "Acquérir" moves a piece into the
 * collection (the server auto-creates a pre-order when it isn't out yet).
 */
export default function WishlistPage() {
  const t = useT();
  const me = useMe();
  const wishlist = useWishlistItems();
  const patch = usePatchWishlistItem();
  const remove = useRemoveWishlistItem();
  const addOwned = useAddOwnedItem();
  const locale = document.documentElement.lang || undefined;
  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  const prefCurrency = me.data?.user?.preferred_currency || "EUR";

  const items = wishlist.data ?? [];

  // Budget = sum of target prices, dominant currency.
  const budget = useMemo(() => {
    const byCur = new Map();
    for (const it of items) {
      if (it.max_price_amount == null) continue;
      const c = it.max_price_currency || prefCurrency;
      byCur.set(c, (byCur.get(c) || 0) + Number(it.max_price_amount));
    }
    if (byCur.size === 0) return null;
    let best = null;
    for (const [currency, amount] of byCur) if (!best || amount > best.amount) best = { currency, amount };
    return best;
  }, [items, prefCurrency]);

  const [editId, setEditId] = useState(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const startEdit = (it) => {
    setEditId(it.figure_id);
    setDraftAmount(it.max_price_amount != null ? String(it.max_price_amount) : "");
    setDraftNote(it.note || "");
  };
  const saveEdit = (it) => {
    const raw = draftAmount.trim().replace(",", ".");
    const amount = raw === "" ? null : Number(raw);
    if (amount != null && !Number.isFinite(amount)) return;
    patch.mutate(
      {
        figure_id: it.figure_id,
        patch: {
          max_price_amount: amount,
          max_price_currency: amount == null ? null : it.max_price_currency || prefCurrency,
          note: draftNote.trim() || null,
        },
      },
      { onSuccess: () => setEditId(null) },
    );
  };
  const acquire = (it) =>
    addOwned.mutate({ figure_id: it.figure_id }, { onSuccess: () => remove.mutate(it.figure_id) });

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-0 right-0 h-[380px] -z-0"
          style={{
            background:
              "radial-gradient(46% 62% at 18% 0%, color-mix(in oklab, var(--color-laque) 16%, transparent), transparent 70%), radial-gradient(44% 58% at 86% 6%, color-mix(in oklab, var(--color-or) 16%, transparent), transparent 72%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage: "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />
        <Reveal as="header" className="relative mb-8">
          <span aria-hidden className="kanji-mark text-[24rem] -top-28 -right-6 hidden md:block">望</span>
          <p className="micro">{t("wishlist.eyebrow")}</p>
          <h1 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] mt-2">{t("wishlist.title")}</h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">{t("wishlist.body")}</p>
          <Link
            to="/souhaits/import"
            className="inline-flex items-center gap-2 mt-5 px-4 py-2.5 border border-[color-mix(in_oklab,var(--color-or)_40%,transparent)] text-[var(--color-or-pale)] text-[11px] uppercase tracking-[0.2em] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
          >
            ↓ {t("wishlist.import.cta")}
          </Link>
        </Reveal>

        {wishlist.isLoading ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-16">…</p>
        ) : items.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
            <div className="flex items-baseline gap-6 flex-wrap mb-7">
              <span className="flex items-baseline gap-2">
                <span className="figural text-3xl text-[var(--color-ivoire)]">{items.length}</span>
                <span className="micro-tight">{t("wishlist.count_label")}</span>
              </span>
              {budget ? (
                <span className="flex items-baseline gap-2">
                  <span className="figural text-3xl text-[var(--color-or-pale)]">~ {fmtMoney(Math.round(budget.amount), budget.currency, locale)}</span>
                  <span className="micro-tight">{t("wishlist.budget_label")}</span>
                </span>
              ) : null}
            </div>

            <div className="grid gap-6 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
              {items.map((it, i) => {
                const hue = typeHue(it.figure_type);
                const cover = coverFor(it);
                const blur = it.is_nsfw && nsfwBlur;
                const editing = editId === it.figure_id;
                const dealMet =
                  it.max_price_amount != null && it.msrp_amount != null &&
                  (it.max_price_currency || prefCurrency) === (it.msrp_currency || it.max_price_currency || prefCurrency) &&
                  Number(it.msrp_amount) <= Number(it.max_price_amount);
                return (
                  <Reveal as="article" delay={Math.min(i * 0.04, 0.3)} key={it.figure_id} className="relative flex flex-col bg-[var(--color-noir-soft)] border border-[color-mix(in_oklab,var(--color-or)_16%,transparent)]">
                    <Link to={`/figures/${it.figure_id}`} className="relative block aspect-[4/5] overflow-hidden group/well" style={{ background: "radial-gradient(circle at 30% 18%, var(--color-noir-soft), var(--color-noir-deep) 60%)" }}>
                      <span aria-hidden className="absolute top-0 left-0 right-0 h-[2px] z-[2]" style={{ background: `linear-gradient(90deg, transparent, ${hue} 28%, ${hue} 72%, transparent)` }} />
                      {cover ? (
                        <img src={cover} alt="" loading="lazy" className={`absolute inset-0 w-full h-full object-cover ${blur ? "nsfw-blur" : ""}`} />
                      ) : (
                        <span aria-hidden className="ja absolute inset-0 grid place-items-center text-[4.5rem]" style={{ color: `color-mix(in oklab, ${hue} 45%, transparent)` }}>{typeKanji(it.figure_type)}</span>
                      )}
                      <span aria-hidden className="absolute top-2.5 right-2.5 z-[3] w-[30px] h-[30px] grid place-items-center text-[14px] bg-[color-mix(in_oklab,var(--color-noir-deep)_70%,transparent)] border border-[color-mix(in_oklab,var(--color-laque-bright)_50%,transparent)] text-[var(--color-laque-bright)]">♥</span>
                      <span className="absolute left-0 right-0 bottom-0 z-[2] flex items-center justify-between px-2.5 py-2 font-mono text-[11px] [background:linear-gradient(to_top,color-mix(in_oklab,var(--color-noir-deep)_90%,transparent),transparent)]">
                        <span className="text-[8.5px] tracking-[0.18em] uppercase text-[var(--color-or-pale)]">{t("wishlist.target")}</span>
                        <span className="text-[var(--color-ivoire)] text-[13px]">{it.max_price_amount != null ? `≤ ${fmtMoney(it.max_price_amount, it.max_price_currency || prefCurrency, locale)}` : t("wishlist.no_target")}</span>
                      </span>
                    </Link>

                    <div className="p-4 flex-1 flex flex-col">
                      <h3 className="display text-xl text-[var(--color-ivoire)] leading-tight line-clamp-2">{it.figure_name}</h3>
                      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[var(--color-ivoire-soft)]">
                        <span className="chip">{t(`type.${it.figure_type}`)}</span>
                        {it.manufacturer_name ? <span className="font-mono truncate">{it.manufacturer_name}</span> : null}
                      </div>

                      {editing ? (
                        <div className="mt-3 space-y-2">
                          <label className="flex items-center border border-[var(--color-or)] bg-[var(--color-noir)]">
                            <span className="px-2 text-[var(--color-or-deep)] font-mono text-xs">{it.max_price_currency || prefCurrency}</span>
                            <input autoFocus inputMode="decimal" value={draftAmount} onChange={(e) => setDraftAmount(e.target.value)} placeholder={t("wishlist.target_ph")} className="flex-1 w-full bg-transparent text-[var(--color-ivoire)] font-mono text-sm py-1.5 pr-2 outline-none" />
                          </label>
                          <input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder={t("wishlist.note_ph")} className="w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_22%,transparent)] text-[var(--color-ivoire)] text-[12px] px-2 py-1.5 outline-none focus:border-[var(--color-or)]" />
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => saveEdit(it)} disabled={patch.isPending} className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 bg-[var(--color-or)] text-[var(--color-noir)]">{t("editor.save")}</button>
                            <button type="button" onClick={() => setEditId(null)} className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]">{t("editor.cancel")}</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {it.note ? <p className="mt-2.5 text-[11px] italic text-[var(--color-ivoire-soft)] border-l-2 border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] pl-2 line-clamp-2">{it.note}</p> : null}
                          {dealMet ? <p className="mt-2.5 text-[10px] uppercase tracking-[0.1em] text-[var(--color-jade)]">◆ {t("wishlist.under_target", { p: fmtMoney(it.msrp_amount, it.msrp_currency || prefCurrency, locale) })}</p> : null}
                          <div className="mt-auto pt-3 flex gap-2">
                            <button type="button" onClick={() => acquire(it)} disabled={addOwned.isPending} className="flex-1 text-[10px] uppercase tracking-[0.12em] py-2 bg-[var(--color-or)] text-[var(--color-noir)]">{t("wishlist.acquire")}</button>
                            <button type="button" onClick={() => startEdit(it)} title={t("wishlist.edit_target")} className="w-9 grid place-items-center border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] text-[var(--color-or-pale)]">✎</button>
                            <button type="button" onClick={() => remove.mutate(it.figure_id)} title={t("wishlist.remove")} className="w-9 grid place-items-center border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors">×</button>
                          </div>
                        </>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function EmptyState({ t }) {
  return (
    <div className="text-center py-20">
      <p className="ja text-[6rem] text-[var(--color-or)]/30 leading-none">望</p>
      <p className="mt-3 text-[var(--color-ivoire-soft)] italic">{t("wishlist.empty")}</p>
      <Link to="/browse" className="inline-block mt-5 px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors">
        {t("wishlist.empty_cta")}
      </Link>
    </div>
  );
}
