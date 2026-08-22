import { useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Download, Search } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useWishlistItems, usePatchWishlistItem, useRemoveWishlistItem, useWishlistPriceHistory } from "../hooks/useWishlist.js";
import { useAddOwnedItem } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import { PageLayout, Section } from "../components/layout/index.js";
import { Button, EmptyState } from "../components/ui/index.js";
import { useToast } from "../components/ui/Toast.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ErrorState from "../components/ErrorState.jsx";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import { useDisplayCurrency } from "../components/DisplayCurrencyProvider.jsx";
import { sumInDisplay } from "../lib/money.js";
import { toSeries } from "../components/PriceHistory.jsx";
import { floorStats } from "./wishlist/priceFloor.js";
import { syncMirror } from "../lib/db.js";
import useUrlState, { asBool } from "../hooks/useUrlState.js";
import { dealIsMet } from "./wishlist/dealLogic.js";
import WishlistKpiStrip from "./wishlist/WishlistKpiStrip.jsx";
import GiftShareSection from "./wishlist/GiftShareSection.jsx";
import WishItem from "./wishlist/WishItem.jsx";

/**
 * « Souhaits » — target pieces to acquire, each with an optional target price
 * ("cible") + note, deal tracking, and a VISIBLE gift-share action.
 * "Acquérir" moves a piece into the collection (the server auto-creates a
 * pre-order when it isn't out yet).
 *
 * Direction A ("Shōjo-Noir") on the shared foundation: thin orchestrator over
 * PageLayout (kicker → AccentTitle → gold-rule, single primary CTA = import) +
 * a KPI strip of true wishlist metrics (gold = value) + the gift-share control
 * + the coveted-pieces grid. Manual editing of the target price / note stays
 * inline on each card. All data hooks and mutations are unchanged.
 */
/** Wishlist view state that belongs in the URL (shareable, back-restorable). */
const WISH_VIEW_DEFS = {
  instock: { default: false, ...asBool },
};

export default function WishlistPage() {
  const t = useT();
  const me = useMe();
  const toast = useToast();
  const wishlist = useWishlistItems();
  const patch = usePatchWishlistItem();
  const remove = useRemoveWishlistItem();
  const addOwned = useAddOwnedItem();
  const locale = document.documentElement.lang || undefined;
  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  const prefCurrency = me.data?.user?.preferred_currency || "EUR";

  const allItems = useMemo(() => wishlist.data ?? [], [wishlist.data]);
  // "En stock" lens — the price cron already knows which shops have the piece
  // again; this narrows the list to what can actually be bought right now.
  const [view, setView] = useUrlState(WISH_VIEW_DEFS);
  const inStockOnly = view.instock;
  const items = useMemo(
    () => (inStockOnly ? allItems.filter((it) => it.stock_status === "in_stock" || it.stock_status === "preorder") : allItems),
    [allItems, inStockOnly],
  );
  const inStockCount = useMemo(
    () => allItems.filter((it) => it.stock_status === "in_stock" || it.stock_status === "preorder").length,
    [allItems],
  );

  useEffect(() => {
    if (wishlist.data) syncMirror("wish", wishlist.data);
  }, [wishlist.data]);

  // Price history for every wished figure — one round-trip, grouped per figure
  // so each row can draw its own floor read.
  const history = useWishlistPriceHistory(allItems.length > 0);
  const floorByFigure = useMemo(() => {
    const byFig = new Map();
    for (const row of history.data ?? []) {
      const arr = byFig.get(row.figure_id);
      if (arr) arr.push(row);
      else byFig.set(row.figure_id, [row]);
    }
    const out = new Map();
    for (const [fid, rows] of byFig) {
      const stats = floorStats(toSeries(rows));
      if (stats) out.set(fid, stats);
    }
    return out;
  }, [history.data]);

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
  const showBudgetConv = budgetConv && (budget.buckets.length > 1 || budgetConv.converted);

  // Glanceable wishlist metrics derived from the data the `/me/wishlist` DTO
  // actually carries (no release-date/preorder-phase field on a wish, so we
  // surface "targeted" + "deals met" instead — both meaningful, both true).
  const targeted = useMemo(() => items.filter((it) => it.max_price_amount != null).length, [items]);
  const dealsMet = useMemo(
    () => items.filter((it) => dealIsMet(it, prefCurrency, dc.rates)).length,
    [items, prefCurrency, dc.rates],
  );

  const [editId, setEditId] = useState(null);
  const [draftAmount, setDraftAmount] = useState("");
  const [draftNote, setDraftNote] = useState("");
  // Wish queued for removal confirmation; null when the dialog is closed.
  const [pendingRemove, setPendingRemove] = useState(null);
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
    addOwned.mutate(
      { figure_id: it.figure_id },
      {
        onSuccess: () => {
          remove.mutate(it.figure_id);
          toast.success(
            t("wishlist.acquired", { default: "Pièce ajoutée à la collection" }),
          );
        },
      },
    );

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (wishlist.isError) {
    return (
      <AppShell>
        <PageLayout width="wide">
          <ErrorState error={wishlist.error} onRetry={() => wishlist.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  // Based on the unfiltered list: turning on a lens must not make the page
  // look like an empty wishlist and re-offer onboarding.
  const hasItems = allItems.length > 0;

  return (
    <AppShell>
      <PageLayout
        kicker={t("wishlist.kicker", { default: "COLLECTION · 願 · SOUHAITS" })}
        title={t("wishlist.page_title")}
        kanji="願"
        width="wide"
        toolbar={
          hasItems ? (
            <Button
              as={Link}
              to="/collection/souhaits/import"
              variant="primary"
              size="sm"
              iconStart={<Download size={16} />}
              className="uppercase"
            >
              {t("wishlist.import.cta")}
            </Button>
          ) : null
        }
      >
        <p className="text-[var(--on-surface-muted)] text-lg leading-relaxed max-w-2xl -mt-2 mb-2">
          {t("wishlist.body")}
        </p>

        {wishlist.isLoading ? (
          <SectionSkeleton />
        ) : !hasItems ? (
          <EmptyState
            kanji="願"
            eyebrow={t("wishlist.empty.eyebrow", { default: "Liste vide" })}
            title={t("wishlist.empty.title", { default: "Aucun souhait pour l'instant" })}
            body={t("wishlist.empty")}
          >
            <Button as={Link} to="/catalogue" variant="primary">
              {t("wishlist.empty_cta")}
            </Button>
            <Button
              as={Link}
              to="/collection/souhaits/import"
              variant="ghost"
              iconStart={<Download size={16} />}
            >
              {t("wishlist.import.cta")}
            </Button>
          </EmptyState>
        ) : (
          <>
            <WishlistKpiStrip
              t={t}
              count={allItems.length}
              targeted={targeted}
              dealsMet={dealsMet}
              budget={budget}
              budgetConv={budgetConv}
              showBudgetConv={showBudgetConv}
              displayCurrency={dc.display}
            />

            <div className="mt-8">
              <GiftShareSection t={t} />
            </div>

            <Section
              className="mt-8"
              kicker={t("wishlist.section.pieces", { default: "Les pièces convoitées" })}
              actions={
                <div className="flex items-center gap-2">
                  {inStockCount > 0 ? (
                    <button
                      type="button"
                      aria-pressed={inStockOnly}
                      onClick={() => setView({ instock: !inStockOnly })}
                      className={`chip tap-target ${inStockOnly ? "chip--solid" : ""}`}
                    >
                      {t("wishlist.lens.instock")}
                      <span className="tabular-nums opacity-70">{inStockCount}</span>
                    </button>
                  ) : null}
                  <Button
                    as={Link}
                    to="/catalogue"
                    variant="subtle"
                    size="sm"
                    iconStart={<Search size={15} />}
                    className="uppercase"
                  >
                    {t("nav.browse")}
                  </Button>
                </div>
              }
              divider
            >
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {items.map((it, i) => (
                  <Reveal as="li" key={it.figure_id} delay={Math.min(i, 7) * 0.05} y={24}>
                    <WishItem
                      it={it}
                      t={t}
                      floor={floorByFigure.get(it.figure_id)}
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
                      onRemove={() => setPendingRemove(it)}
                      saving={patch.isPending}
                      acquiring={addOwned.isPending}
                    />
                  </Reveal>
                ))}
              </ul>
            </Section>
          </>
        )}
      </PageLayout>

      <ConfirmDialog
        open={!!pendingRemove}
        title={t("wishlist.remove")}
        body={t("wishlist.remove.body")}
        confirmLabel={t("editor.confirm")}
        destructive
        busy={remove.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => {
          if (pendingRemove) {
            remove.mutate(pendingRemove.figure_id, {
              onSuccess: () => setPendingRemove(null),
              onError: () => setPendingRemove(null),
            });
          }
        }}
      />
    </AppShell>
  );
}
