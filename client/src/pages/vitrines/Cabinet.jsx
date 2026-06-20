import { Trash2 } from "lucide-react";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import Card from "../../components/Card.jsx";
import Money from "../../components/Money.jsx";
import { effectiveValue } from "../../lib/money.js";
import { SortableTile } from "./VitrineTile.jsx";

/** Per-currency aggregate of a cabinet's pieces → dominant bucket. */
export function cabinetValue(items) {
  const byCur = new Map();
  for (const it of items) {
    const ev = effectiveValue(it);
    if (!ev) continue;
    const cur = ev.currency || "EUR";
    byCur.set(cur, (byCur.get(cur) || 0) + ev.amount);
  }
  if (byCur.size === 0) return null;
  let best = null;
  for (const [currency, amount] of byCur)
    if (!best || amount > best.amount) best = { currency, amount };
  return { ...best, multi: byCur.size > 1 };
}

// Empty-shelf affordance — a centred, dashed-feeling cue inviting a drop. The
// kanji whispers "place" (置). Spans the 3-column specimen grid.
function DropHint({ t }) {
  return (
    <div className="col-span-3 grid place-items-center text-center py-7 gap-1.5">
      <span
        aria-hidden
        className="ja text-2xl leading-none text-[color-mix(in_oklab,var(--color-or)_35%,transparent)]"
      >
        置
      </span>
      <p className="text-[12px] text-[var(--color-ivoire-soft)] italic">
        {t("vitrines.drop_hint")}
      </p>
    </div>
  );
}

function GlassSheen() {
  return (
    <span
      aria-hidden
      className="absolute inset-0 z-[3] pointer-events-none"
      style={{
        background:
          "linear-gradient(118deg, transparent 38%, oklch(1 0 0 / 0.05) 49%, transparent 60%)",
      }}
    />
  );
}

function CabinetValue({ items, t }) {
  const v = cabinetValue(items);
  if (!v) return null;
  return (
    <div className="text-right">
      <div className="display text-lg text-[var(--color-or-pale)] whitespace-nowrap">
        <Money amount={v.amount} currency={v.currency} />
      </div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] mt-0.5">
        {t("vitrines.cabinet_value")}
      </div>
    </div>
  );
}

/**
 * One display case. Registered + free-text cabinets read as a lit glass vitrine
 * (Card surface, brass-plaque header, kanji marker, gold-rule shelf edges, glass
 * sheen); the "unshelved" group is a dashed reserve crate.
 *
 * The droppable + SortableContext wiring is preserved verbatim from the original
 * page — only the chrome around the specimen grid was extracted into this
 * page-local component.
 */
export default function Cabinet({
  id,
  name,
  loose,
  ids,
  itemMap,
  registered,
  onDelete,
  nsfwBlur,
  matchedIds,
  openItem,
  t,
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const items = ids.map((i) => itemMap.get(i)).filter(Boolean);
  // 棚 (shelf) for a registered cabinet, 飾 (display) for a free-text one.
  const marker = loose ? "" : registered ? "棚" : "飾";

  if (loose) {
    return (
      <article
        className={`relative overflow-hidden border border-dashed transition-colors ${
          isOver
            ? "border-[var(--color-or)] ring-1 ring-[var(--color-or)]"
            : "border-[color-mix(in_oklab,var(--color-or)_28%,transparent)]"
        }`}
        style={{ background: "color-mix(in oklab, var(--color-noir-deep) 55%, transparent)" }}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-dashed border-[color-mix(in_oklab,var(--color-or)_28%,transparent)]">
          <div className="min-w-0">
            <h2 className="display text-xl leading-tight truncate italic text-[var(--color-ivoire-soft)]">
              {t("vitrines.loose")}
            </h2>
            <p className="micro-tight mt-1">{t("vitrines.loose_count", { n: items.length })}</p>
          </div>
        </header>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div ref={setNodeRef} className="relative grid grid-cols-3 gap-2.5 p-4 min-h-[96px]">
            {items.length === 0 ? (
              <DropHint t={t} />
            ) : (
              items.map((o) => (
                <SortableTile
                  key={o.id}
                  o={o}
                  nsfwBlur={nsfwBlur}
                  matchedIds={matchedIds}
                  openItem={openItem}
                />
              ))
            )}
          </div>
        </SortableContext>
      </article>
    );
  }

  return (
    <Card
      as="article"
      className={`overflow-hidden transition-colors ${
        isOver ? "!border-[var(--color-or)] ring-1 ring-[var(--color-or)]" : ""
      }`}
    >
      {/* Lit-glass atmosphere: a faint kanji marker behind the shelf + the
          shared diagonal sheen catching the room's single light. Both static
          and pointer-inert — GPU-free. */}
      <span aria-hidden className="kanji-mark text-[7rem] -top-5 -right-1 select-none">
        {marker}
      </span>
      <GlassSheen />
      {/* Display-case spotlight — a single warm lamp washing the shelf from
          above, so the specimens read as lit on a stage (diorama feel). Static,
          pointer-inert → GPU-free. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 w-[78%] h-44 z-[1]"
        style={{
          background:
            "radial-gradient(58% 100% at 50% 0, color-mix(in oklab, var(--color-or) 15%, transparent), transparent 72%)",
        }}
      />

      {/* Brass plaque — the cabinet's name + a kanji tag, over the front
          gold-rule shelf edge. */}
      <header className="relative z-[2] flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <p className="micro-tight flex items-center gap-1.5">
            <span aria-hidden className="ja not-italic text-sm leading-none text-[var(--color-or)]">
              {marker}
            </span>
            {registered
              ? t("vitrines.cabinet_kicker", { default: "Meuble" })
              : t("vitrines.cabinet_kicker_freetext", { default: "Emplacement" })}
          </p>
          <h2 className="display text-xl leading-tight truncate text-[var(--color-ivoire)] mt-1">
            {name}
          </h2>
          <p className="micro-tight mt-1 text-[var(--color-ivoire-soft)]/70">
            {t("vitrines.piece_count", { n: items.length })}
          </p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <CabinetValue items={items} t={t} />
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              title={t("vitrines.delete_cabinet")}
              className="tap-target w-11 h-11 -mr-1.5 -mt-1 grid place-items-center text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
            >
              <Trash2 size={16} />
              <span className="sr-only">{t("vitrines.delete_cabinet")}</span>
            </button>
          ) : null}
        </div>
      </header>
      {/* Front shelf edge — a gold hairline under the plaque. */}
      <div aria-hidden className="relative z-[2] gold-rule mx-4" />

      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div
          ref={setNodeRef}
          className="relative z-[1] grid grid-cols-3 gap-2.5 px-4 pt-4 pb-3 min-h-[96px]"
        >
          {items.length === 0 ? (
            <DropHint t={t} />
          ) : (
            items.map((o) => (
              <SortableTile
                key={o.id}
                o={o}
                nsfwBlur={nsfwBlur}
                matchedIds={matchedIds}
                openItem={openItem}
              />
            ))
          )}
        </div>
      </SortableContext>
      {/* Base shelf edge — a fainter gold rule grounding the case. */}
      <div
        aria-hidden
        className="relative z-[2] mx-4 mb-3 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklab, var(--color-or) 45%, transparent) 30%, color-mix(in oklab, var(--color-or) 45%, transparent) 70%, transparent)",
        }}
      />
    </Card>
  );
}
