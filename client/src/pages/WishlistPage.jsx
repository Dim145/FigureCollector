import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useWishlistItems, usePatchWishlistItem, useRemoveWishlistItem } from "../hooks/useWishlist.js";
import { useAddOwnedItem } from "../hooks/useCollection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import GiftSharePanel from "../components/GiftSharePanel.jsx";
import StatCard from "../components/StatCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import Money from "../components/Money.jsx";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import { fmtMoney, sumInDisplay, rateToEur } from "../lib/money.js";

const coverFor = (it) =>
  it.catalog_cover_photo_id ? `/api/figure-photos/${it.catalog_cover_photo_id}` : it.figure_image || null;

// Gold (金) is Direction A's value accent — the wishlist leans on it for every
// target-price chip and money figure; hanko red stays for the heart marker and
// destructive intent. A piece's market price (the cron's latest relevé, else
// the catalog MSRP) at/under the user's cible is a "good deal".
const marketPrice = (it) => {
  if (it.provider_price_amount != null) {
    return {
      amount: Number(it.provider_price_amount),
      currency: it.provider_price_currency || it.msrp_currency || null,
    };
  }
  if (it.msrp_amount != null) {
    return { amount: Number(it.msrp_amount), currency: it.msrp_currency || null };
  }
  return null;
};

// A deal compares the market price against the target ACROSS currencies: same
// currency is a direct compare, otherwise both convert to EUR via the display
// provider's rate table (mirrors the server's wishlist alert). When a rate is
// missing — or the table isn't loaded (conversion off / no preferred currency)
// — it falls back to same-currency only.
const dealIsMet = (it, prefCurrency, rates) => {
  const m = marketPrice(it);
  if (it.max_price_amount == null || m == null) return false;
  const target = Number(it.max_price_amount);
  const targetCur = it.max_price_currency || prefCurrency;
  const priceCur = m.currency || targetCur;
  if (!targetCur || !priceCur || targetCur === priceCur) {
    return m.amount <= target;
  }
  const rt = rateToEur(rates, targetCur);
  const rp = rateToEur(rates, priceCur);
  if (rt == null || rp == null) return false;
  return m.amount / rp <= target / rt;
};

/**
 * « Souhaits » — the wishlist: catalogue figures the user covets, each with an
 * optional target price ("cible") + note. "Acquérir" moves a piece into the
 * collection (the server auto-creates a pre-order when it isn't out yet).
 *
 * Direction A — "Shōjo-Noir". Editorial header (kicker → AccentTitle →
 * gold-rule → body + import CTA), a StatCard strip of true wishlist metrics
 * (souhaits · coût cible · ciblées · sous la cible — gold for value), the
 * gift-share panel as an A control, and the coveted pieces in the refined
 * FigureCard grid with gold target-price chips. Manual editing of the target
 * price / note stays inline on each card. Gold = value, hanko red = the wish.
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

  const items = useMemo(() => wishlist.data ?? [], [wishlist.data]);

  // Budget = sum of target prices. Kept per-currency (buckets) so it can be
  // shown converted into the display currency, with the dominant bucket as the
  // native fallback when conversion is off.
  const dc = useDisplayCurrency();
  const budget = useMemo(() => {
    const byCur = new Map();
    for (const it of items) {
      if (it.max_price_amount == null) continue;
      const c = it.max_price_currency || prefCurrency;
      byCur.set(c, (byCur.get(c) || 0) + Number(it.max_price_amount));
    }
    if (byCur.size === 0) return null;
    const buckets = [...byCur].map(([currency, amount]) => ({ currency, amount }));
    let dominant = null;
    for (const b of buckets) if (!dominant || b.amount > dominant.amount) dominant = b;
    return { buckets, dominant };
  }, [items, prefCurrency]);
  const budgetConv =
    budget && dc.active && dc.ready
      ? sumInDisplay(dc.rates, dc.display, budget.buckets, "amount")
      : null;
  const showBudgetConv =
    budgetConv && (budget.buckets.length > 1 || budgetConv.converted);

  // Glanceable wishlist metrics derived from the data the `/me/wishlist` DTO
  // actually carries (no release-date/preorder-phase field on a wish, so we
  // surface "targeted" + "deals met" instead — both meaningful, both true).
  const targeted = useMemo(
    () => items.filter((it) => it.max_price_amount != null).length,
    [items],
  );
  const dealsMet = useMemo(
    () => items.filter((it) => dealIsMet(it, prefCurrency, dc.rates)).length,
    [items, prefCurrency, dc.rates],
  );

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
      <main className="relative max-w-6xl mx-auto px-6 pt-8 pb-16">
        {/* Hero colour-wash — hanko-red leaning (desire) into gold (value),
            theme-aware via the accent vars, mask-faded at the column edges. */}
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

        {/* ─── Editorial header ─── */}
        <header className="relative mb-8">
          <span aria-hidden className="kanji-mark text-[24rem] -top-28 -right-6 hidden md:block select-none">
            望
          </span>

          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span
              aria-hidden
              className="w-1 h-1 rotate-45"
              style={{ background: "var(--color-laque-bright)" }}
            />
            {t("wishlist.kicker", { default: "DÉSIRS · 望 · À ACQUÉRIR" })}
          </p>
          <h1
            className="display text-5xl md:text-6xl text-[var(--color-ivoire)] mt-3 leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("wishlist.page_title")} />
          </h1>
          <div className="gold-rule w-24 mt-6 reveal" style={{ "--i": 2 }} />
          <p
            className="mt-6 text-[var(--color-ivoire-soft)] text-lg leading-relaxed max-w-2xl reveal"
            style={{ "--i": 3 }}
          >
            {t("wishlist.body")}
          </p>

          {/* Import CTA — gold-outline ghost control, A treatment. */}
          <div className="mt-7 flex flex-wrap gap-2.5 reveal" style={{ "--i": 4 }}>
            <Link to="/souhaits/import">
              <Button variant="ghost" className="!px-5 !py-2.5 text-[11px] uppercase tracking-[0.18em]">
                <span aria-hidden>↓</span> {t("wishlist.import.cta")}
              </Button>
            </Link>
            <Link to="/browse">
              <Button variant="ghost" className="!px-5 !py-2.5 text-[11px] uppercase tracking-[0.18em]">
                {t("nav.browse")}
              </Button>
            </Link>
          </div>

          {/* Stat strip — true wishlist metrics; gold reserved for value. */}
          {items.length > 0 ? (
            <div
              className="mt-9 grid grid-cols-2 lg:grid-cols-4 gap-3 reveal"
              style={{ "--i": 5 }}
            >
              <StatCard label={t("wishlist.count_label")} value={items.length} />
              <StatCard
                label={t("wishlist.budget_label")}
                value={
                  budget ? (
                    showBudgetConv ? (
                      <Money
                        amount={budgetConv.amount}
                        currency={dc.display}
                        approx
                        round
                      />
                    ) : (
                      <span>
                        {budget.buckets.length > 1 ? "~ " : ""}
                        <Money
                          amount={budget.dominant.amount}
                          currency={budget.dominant.currency}
                          round
                        />
                      </span>
                    )
                  ) : (
                    "—"
                  )
                }
                sub={budget ? t("wishlist.kpi.targeted_sub", { n: targeted, default: "{n} ciblées" }) : null}
                tone="gold"
              />
              <StatCard
                label={t("wishlist.kpi.targeted", { default: "Avec cible" })}
                value={targeted}
                sub={t("wishlist.kpi.untargeted_sub", { n: items.length - targeted, default: "{n} sans cible" })}
              />
              <StatCard
                label={t("wishlist.kpi.deals", { default: "Sous la cible" })}
                value={dealsMet}
                tone="gold"
              />
            </div>
          ) : null}
        </header>

        {/* ─── Empty / loading / grid ─── */}
        {wishlist.isLoading ? (
          <p role="status" aria-live="polite" className="text-center text-[var(--color-ivoire-soft)] py-16">
            …
          </p>
        ) : items.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <>
            <GiftSharePanel />

            {/* Section kicker over the grid — editorial divider. */}
            <div className="flex items-center gap-4 mb-7">
              <p className="micro whitespace-nowrap">
                {t("wishlist.section.pieces", { default: "Les pièces convoitées" })}
              </p>
              <span
                aria-hidden
                className="flex-1 h-px"
                style={{ background: "color-mix(in oklab, var(--color-or) 18%, transparent)" }}
              />
              <span className="figural text-sm text-[var(--color-or-pale)] tabular-nums">
                {items.length}
              </span>
            </div>

            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {items.map((it, i) => (
                <Reveal as="li" key={it.figure_id} delay={Math.min(i, 7) * 0.05} y={24}>
                  <WishItem
                    it={it}
                    t={t}
                    locale={locale}
                    prefCurrency={prefCurrency}
                    blur={it.is_nsfw && nsfwBlur}
                    editing={editId === it.figure_id}
                    draftAmount={draftAmount}
                    draftNote={draftNote}
                    setDraftAmount={setDraftAmount}
                    setDraftNote={setDraftNote}
                    onStartEdit={() => startEdit(it)}
                    onCancelEdit={() => setEditId(null)}
                    onSave={() => saveEdit(it)}
                    onAcquire={() => acquire(it)}
                    onRemove={() => remove.mutate(it.figure_id)}
                    saving={patch.isPending}
                    acquiring={addOwned.isPending}
                  />
                </Reveal>
              ))}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  );
}

/**
 * One coveted piece — the refined FigureCard with a wishlist action tray
 * beneath it. At rest the tray shows the gold target-price chip (or "libre"),
 * a "sous la cible" deal note + the user's reminder, and the Acquérir CTA with
 * quiet edit/remove affordances. Editing swaps the tray for the inline
 * price/note form. The laque heart on the card marks it as wished.
 */
function WishItem({
  it,
  t,
  locale,
  prefCurrency,
  blur,
  editing,
  draftAmount,
  draftNote,
  setDraftAmount,
  setDraftNote,
  onStartEdit,
  onCancelEdit,
  onSave,
  onAcquire,
  onRemove,
  saving,
  acquiring,
}) {
  const dc = useDisplayCurrency();
  const priced = it.max_price_amount != null;
  const deal = dealIsMet(it, prefCurrency, dc.rates);
  const currency = it.max_price_currency || prefCurrency;

  return (
    <div className="h-full flex flex-col">
      <FigureCard
        figureId={it.figure_id}
        href={`/figures/${it.figure_id}`}
        name={it.figure_name}
        type={it.figure_type}
        manufacturer={it.manufacturer_name}
        imageUrl={coverFor(it)}
        scale={it.scale}
        wished
        blurImage={blur}
      />

      {editing ? (
        /* Inline target-price / note editor — same mutation payload as before. */
        <div className="mt-3 px-1 space-y-2">
          <label
            className="flex items-center bg-[var(--color-noir)]"
            style={{ border: "1px solid var(--color-or)" }}
          >
            <span className="px-2.5 text-[var(--color-or-deep)] font-mono text-xs">{currency}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSave();
                if (e.key === "Escape") onCancelEdit();
              }}
              placeholder={t("wishlist.target_ph")}
              aria-label={t("wishlist.edit_target")}
              className="flex-1 w-full bg-transparent text-[var(--color-ivoire)] font-mono text-sm py-2 pr-2 outline-none"
            />
          </label>
          <input
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave();
              if (e.key === "Escape") onCancelEdit();
            }}
            placeholder={t("wishlist.note_ph")}
            aria-label={t("wishlist.note_ph")}
            className="w-full bg-[var(--color-noir)] text-[var(--color-ivoire)] text-[12px] px-2.5 py-2 outline-none transition-colors focus:border-[var(--color-or)]"
            style={{ border: "1px solid color-mix(in oklab, var(--color-or) 22%, transparent)" }}
          />
          <div className="flex gap-1.5">
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={saving}
              loading={saving}
              className="flex-1 uppercase"
            >
              {t("editor.save")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelEdit}
              className="uppercase"
            >
              {t("editor.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Action tray — mirrors CollectionPage's per-card meta row. */}
          <div className="mt-3 px-1 min-h-[2.25rem] flex items-center justify-between gap-3">
            {priced ? (
              <span
                className="inline-flex items-baseline gap-1.5 text-[11px] font-mono tracking-wide px-2 py-1"
                style={{
                  color: "var(--color-or-pale)",
                  border: "1px solid color-mix(in oklab, var(--color-or) 32%, transparent)",
                  background: "color-mix(in oklab, var(--color-or) 7%, transparent)",
                }}
                title={t("wishlist.target")}
              >
                <span className="text-[8.5px] uppercase tracking-[0.18em] text-[var(--color-or-deep)]">
                  {t("wishlist.target")}
                </span>
                <span className="figural text-[13px] text-[var(--color-ivoire)]">
                  ≤ <Money amount={it.max_price_amount} currency={currency} />
                </span>
              </span>
            ) : (
              <span className="micro-tight text-[var(--color-ivoire-soft)]/60">
                {t("wishlist.no_target")}
              </span>
            )}

            <button
              type="button"
              onClick={onStartEdit}
              title={t("wishlist.edit_target")}
              aria-label={t("wishlist.edit_target")}
              className="tap-target shrink-0 w-9 grid place-items-center text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
            >
              ✎
            </button>
          </div>

          {/* Deal note + the user's reminder — quiet, value-toned. */}
          {deal ? (
            <p className="mt-2 px-1 text-[10px] uppercase tracking-[0.12em] text-[var(--color-jade)]">
              ◆ {t("wishlist.under_target", {
                p: fmtMoney(
                  marketPrice(it)?.amount,
                  marketPrice(it)?.currency || prefCurrency,
                  locale,
                ),
              })}
            </p>
          ) : null}
          {it.note ? (
            <p
              className="mt-2 px-1 text-[11px] italic text-[var(--color-ivoire-soft)] line-clamp-2 border-l-2 pl-2"
              style={{ borderColor: "color-mix(in oklab, var(--color-or) 30%, transparent)" }}
            >
              {it.note}
            </p>
          ) : null}

          {/* Acquire (red hanko pill) + remove. */}
          <div className="mt-3 px-1 flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={onAcquire}
              disabled={acquiring}
              loading={acquiring}
              className="flex-1 uppercase"
            >
              {t("wishlist.acquire")}
            </Button>
            <button
              type="button"
              onClick={onRemove}
              title={t("wishlist.remove")}
              aria-label={t("wishlist.remove")}
              className="tap-target shrink-0 w-11 grid place-items-center border text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
              style={{ borderColor: "color-mix(in oklab, var(--color-or) 25%, transparent)" }}
            >
              ×
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Empty wishlist — an editorial Card with the 望 watermark + a calm note and
 *  a red CTA into the catalogue (mirrors CollectionPage's EmptyState). */
function EmptyState({ t }) {
  return (
    <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden frame-corners">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none pointer-events-none"
      >
        望
      </span>
      <p className="micro relative">{t("wishlist.empty.eyebrow", { default: "Liste vide" })}</p>
      <h2 className="display text-3xl mt-3 text-[var(--color-ivoire)] relative">
        {t("wishlist.empty.title", { default: "Aucun souhait pour l'instant" })}
      </h2>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">{t("wishlist.empty")}</p>
      <div className="gold-rule mx-auto w-20 my-8" />
      <div className="flex flex-wrap gap-3 justify-center relative">
        <Link to="/browse">
          <Button variant="primary">{t("wishlist.empty_cta")}</Button>
        </Link>
        <Link to="/souhaits/import">
          <Button variant="ghost">{t("wishlist.import.cta")}</Button>
        </Link>
      </div>
    </Card>
  );
}
