import { useState } from "react";
import Reveal from "../../components/motion/Reveal.jsx";
import Button from "../../components/Button.jsx";
import Select from "../../components/Select.jsx";
import Drawer from "../../components/ui/Drawer.jsx";
import FigureCard from "../../components/FigureCard.jsx";
import { resolveOwnedCover } from "../../lib/coverUrl.js";
import { preorderBadgeLabel, preorderPhase } from "../../lib/preorderStatus.js";
import { CONDITION_FILTERS } from "./ConditionFilterRail.jsx";

/**
 * The figure grid — owned-item cards plus their per-card actions, the
 * multi-select surface, and the bulk-action bar. Owns only its local view
 * concerns (which bulk sheet is open); the selection + every mutation are
 * passed down from CollectionPage.
 *
 * Bulk editing is a real, labelled bar (not the old inline <select> cluster):
 *  - ≥ lg: a sticky gold-tinted toolbar with labelled Selects + buttons and
 *    disabled states until something is selected.
 *  - < lg: a slim sticky launcher ("N sélectionnée(s) · Actions") that opens a
 *    bottom sheet (Drawer) holding the same actions, comfortably tappable.
 */
export default function CollectionGrid({
  t,
  items,
  nsfwBlur,
  pinnedId,
  onPin,
  onRequestRemove,
  removePending,
  // select mode
  selectMode,
  sel,
  // bulk actions (all no-ops unless something is selected)
  bulkBusy,
  locationOptions,
  onBulkSetLocation,
  onBulkSetCondition,
  onBulkArchive,
  onBulkDelete,
  onExitSelect,
}) {
  return (
    <>
      {selectMode ? (
        <BulkBar
          t={t}
          sel={sel}
          bulkBusy={bulkBusy}
          locationOptions={locationOptions}
          onBulkSetLocation={onBulkSetLocation}
          onBulkSetCondition={onBulkSetCondition}
          onBulkArchive={onBulkArchive}
          onBulkDelete={onBulkDelete}
          onExitSelect={onExitSelect}
        />
      ) : null}

      {items.length === 0 ? (
        <p className="text-center text-[var(--color-ivoire-soft)] italic mt-12">
          {t("collection.filter.empty")}
        </p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {items.map((item, i) => (
            <GridItem
              key={item.id}
              item={item}
              index={i}
              t={t}
              nsfwBlur={nsfwBlur}
              selectMode={selectMode}
              selected={sel.isSelected(item.id)}
              onToggle={() => sel.toggle(item.id)}
              pinnedId={pinnedId}
              onPin={onPin}
              onRequestRemove={onRequestRemove}
              removePending={removePending}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** Badge for an owned-item card: archived (cancelled-and-kept) wins, then the
 *  pre-order phase, then a pinned-cover marker. */
function ownedBadge(item, t) {
  if (item.archived_at) {
    return { label: t("collection.archived_badge"), tone: "cancelled" };
  }
  const phase = preorderPhase(item);
  const label = preorderBadgeLabel(phase, t);
  if (label) {
    return { label, tone: phase === "imminent" ? "imminent" : "preorder" };
  }
  if (item.cover_photo_id || item.cover_scan_id) {
    return { label: t("collection.cover.pinned"), tone: "neutral" };
  }
  return null;
}

function GridItem({
  item,
  index,
  t,
  nsfwBlur,
  selectMode,
  selected,
  onToggle,
  pinnedId,
  onPin,
  onRequestRemove,
  removePending,
}) {
  const card = (
    <FigureCard
      figureId={item.figure_id}
      href={selectMode ? undefined : `/figures/${item.figure_id}`}
      name={item.figure_name}
      type={item.figure_type}
      manufacturer={item.manufacturer_name}
      imageUrl={resolveOwnedCover(item)}
      scale={item.scale}
      versionName={item.version_name}
      blurImage={nsfwBlur(item)}
      badge={ownedBadge(item, t)}
    />
  );
  return (
    <Reveal
      as="li"
      delay={Math.min(index, 7) * 0.05}
      y={24}
      // NOTE: no `content-visibility: auto` here. It implies `contain: paint`,
      // which clips descendants to the box — and the card's hover state lifts
      // (translateY(-5px)) and casts an outer glow that then got clipped at the
      // top edge (the border visibly vanished on hover). The catalogue grid has
      // no containment and doesn't suffer this. If off-screen render perf ever
      // matters for huge collections, use windowing (react-virtual), not paint
      // containment, so each card can still overflow with its hover chrome.
    >
      {selectMode ? (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={
            selected
              ? t("bulk.deselect_item", { name: item.figure_name ?? "", default: "Désélectionner" })
              : t("bulk.select_item", { name: item.figure_name ?? "", default: "Sélectionner" })
          }
          className="relative block w-full text-left"
        >
          <span
            aria-hidden
            className={`absolute top-2 left-2 z-[6] w-6 h-6 grid place-items-center text-[12px] ${
              selected
                ? "bg-[var(--color-or)] border border-[var(--color-or)] text-[var(--color-noir)]"
                : "bg-[color-mix(in_oklab,var(--color-noir-deep)_72%,transparent)] border border-[color-mix(in_oklab,var(--color-or)_45%,transparent)] text-transparent"
            }`}
          >
            ✓
          </span>
          <span
            className={`block ${selected ? "outline outline-2 outline-[var(--color-or)]" : ""}`}
          >
            {card}
          </span>
        </button>
      ) : (
        card
      )}
      <div className="mt-3 flex items-center justify-between gap-3 px-1">
        <span className="micro-tight">{t(`condition.${item.condition}`)}</span>
        {!selectMode ? (
          <div className="flex items-center gap-3">
            {item.id !== pinnedId ? (
              <button
                type="button"
                onClick={() => onPin(item.id)}
                title={t("collection.pin", { default: "Épingler à la une" })}
                className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
              >
                ★ {t("collection.pin.short", { default: "À la une" })}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onRequestRemove(item)}
              disabled={removePending}
              className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors disabled:opacity-50"
            >
              {t("collection.remove")}
            </button>
          </div>
        ) : null}
      </div>
    </Reveal>
  );
}

/**
 * Bulk-action bar. Desktop: sticky labelled toolbar. Mobile: a slim sticky
 * launcher opening a bottom sheet with the same controls.
 */
function BulkBar({
  t,
  sel,
  bulkBusy,
  locationOptions,
  onBulkSetLocation,
  onBulkSetCondition,
  onBulkArchive,
  onBulkDelete,
  onExitSelect,
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const none = !sel.someSelected;
  const count = sel.selectedIds.length;
  const conditionOptions = CONDITION_FILTERS.filter((c) => c !== "all").map((c) => ({
    value: c,
    label: t(`condition.${c}`),
  }));

  return (
    <>
      {/* ── Desktop / tablet: full sticky toolbar ───────────────────────── */}
      <div
        role="region"
        aria-label={t("bulk.toolbar", { default: "Actions groupées" })}
        className="hidden lg:flex sticky top-24 z-30 mb-5 flex-wrap items-center gap-2 p-3 border border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-or)_10%,transparent)] backdrop-blur-md"
      >
        <span className="display text-xl text-[var(--color-or-pale)]">
          <b className="text-[var(--color-ivoire)]">{count}</b> {t("bulk.selected_label")}
        </span>
        <button type="button" onClick={sel.toggleAll} className="bulk-act">
          {sel.allSelected ? t("bulk.none") : t("bulk.all")}
        </button>
        <span className="flex-1" />
        <select
          aria-label={t("bulk.set_vitrine")}
          disabled={bulkBusy || none}
          value="__"
          onChange={(e) => {
            const v = e.target.value;
            if (v !== "__") onBulkSetLocation(v);
          }}
          className="bulk-act bg-[var(--color-noir)] disabled:opacity-40"
        >
          <option value="__" disabled>
            {t("bulk.set_vitrine")}
          </option>
          {locationOptions.map((o) => (
            <option key={o.value || "__none"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label={t("bulk.set_condition")}
          disabled={bulkBusy || none}
          value="__"
          onChange={(e) => {
            const v = e.target.value;
            if (v !== "__") onBulkSetCondition(v);
          }}
          className="bulk-act bg-[var(--color-noir)] disabled:opacity-40"
        >
          <option value="__" disabled>
            {t("bulk.set_condition")}
          </option>
          {conditionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={bulkBusy || none}
          onClick={onBulkArchive}
          className="bulk-act disabled:opacity-40"
        >
          {t("bulk.archive")}
        </button>
        <button
          type="button"
          disabled={bulkBusy || none}
          onClick={onBulkDelete}
          className="bulk-act-danger disabled:opacity-40"
        >
          {t("bulk.delete")}
        </button>
        <button
          type="button"
          onClick={onExitSelect}
          className="bulk-act"
          aria-label={t("bulk.done")}
        >
          ✕
        </button>
      </div>

      {/* ── Mobile: slim sticky launcher + bottom sheet ─────────────────── */}
      <div
        className="lg:hidden sticky top-24 z-30 mb-5 flex items-center gap-2 p-3 border border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-or)_10%,transparent)] backdrop-blur-md"
        role="region"
        aria-label={t("bulk.toolbar", { default: "Actions groupées" })}
      >
        <span className="display text-lg text-[var(--color-or-pale)]">
          <b className="text-[var(--color-ivoire)]">{count}</b> {t("bulk.selected_label")}
        </span>
        <button type="button" onClick={sel.toggleAll} className="bulk-act">
          {sel.allSelected ? t("bulk.none") : t("bulk.all")}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={none}
          className="bulk-act disabled:opacity-40"
        >
          {t("bulk.actions", { default: "Actions" })}
        </button>
        <button
          type="button"
          onClick={onExitSelect}
          className="bulk-act min-w-[44px]"
          aria-label={t("bulk.done")}
        >
          ✕
        </button>
      </div>

      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        side="bottom"
        title={t("bulk.toolbar", { default: "Actions groupées" })}
      >
        <p className="micro mb-5">
          {t("bulk.selected_count", {
            n: count,
            default: `${count} sélectionnée(s)`,
          })}
        </p>
        <div className="space-y-5">
          <Select
            label={t("bulk.set_vitrine")}
            value="__"
            onChange={(v) => {
              if (v !== "__") {
                onBulkSetLocation(v);
                setSheetOpen(false);
              }
            }}
            disabled={bulkBusy || none}
            options={[{ value: "__", label: t("bulk.set_vitrine") }, ...locationOptions]}
          />
          <Select
            label={t("bulk.set_condition")}
            value="__"
            onChange={(v) => {
              if (v !== "__") {
                onBulkSetCondition(v);
                setSheetOpen(false);
              }
            }}
            disabled={bulkBusy || none}
            options={[{ value: "__", label: t("bulk.set_condition") }, ...conditionOptions]}
          />
          <div className="flex flex-col gap-3 pt-2">
            <Button
              variant="ghost"
              disabled={bulkBusy || none}
              onClick={() => {
                onBulkArchive();
                setSheetOpen(false);
              }}
            >
              {t("bulk.archive")}
            </Button>
            <Button
              variant="danger"
              disabled={bulkBusy || none}
              onClick={() => {
                setSheetOpen(false);
                onBulkDelete();
              }}
            >
              {t("bulk.delete")}
            </Button>
          </div>
        </div>
      </Drawer>
    </>
  );
}
