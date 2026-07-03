import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
} from "@dnd-kit/core";
import { useShelfLayout, useSaveShelfLayout } from "../hooks/useCollection.js";
import { resolveOwnedCover } from "../lib/coverUrl.js";
import { typeHue, typeKanji } from "../lib/typeHue.js";

const DEFAULT_SHELVES = 3;
const MIN_SHELVES = 1;
const MAX_SHELVES = 6;

/**
 * « Atelier » — free-form planner view of the Vitrines.
 *
 * Drag owned pieces out of the tray onto drawn shelves and place them anywhere
 * along a shelf; pieces stand to scale (a 1/4 towers over a Nendoroid) on a
 * gold ledge. Positions persist per user (debounced PUT /me/shelf-layout) as an
 * opaque `{ shelves, placed:{ id:{shelf,x} } }` document. Drag a piece back to
 * the tray to un-place it. dnd-kit handles pointer/touch; placement x is the
 * drop point projected onto the target shelf.
 *
 * @param {object[]} items            owned items (already NSFW-filtered upstream)
 * @param {boolean}  nsfwBlur         blur NSFW covers per the viewer's pref
 * @param {(o:object)=>number} standeeWidthPx  real-height → px (shared with the diorama)
 * @param {Function} t
 */
export default function ShelfPlanner({ items, nsfwBlur, standeeWidthPx, t }) {
  const layoutQ = useShelfLayout();
  const save = useSaveShelfLayout();
  const [shelves, setShelves] = useState(DEFAULT_SHELVES);
  const [placed, setPlaced] = useState({}); // { ownedId: { shelf, x } }
  const [activeId, setActiveId] = useState(null);
  const hydrated = useRef(false);

  // Hydrate from the server once.
  useEffect(() => {
    if (hydrated.current || !layoutQ.data) return;
    hydrated.current = true;
    const d = layoutQ.data || {};
    if (Number.isFinite(d.shelves)) {
      setShelves(Math.max(MIN_SHELVES, Math.min(MAX_SHELVES, d.shelves)));
    }
    if (d.placed && typeof d.placed === "object") setPlaced(d.placed);
  }, [layoutQ.data]);

  // Debounced persist — only after hydration so we never overwrite the stored
  // layout with the empty default on first paint.
  const saveTimer = useRef(null);
  const pendingSave = useRef(null); // latest payload awaiting the debounce
  useEffect(() => {
    if (!hydrated.current) return;
    clearTimeout(saveTimer.current);
    const payload = { shelves, placed };
    pendingSave.current = payload;
    saveTimer.current = setTimeout(() => {
      pendingSave.current = null;
      save.mutate(payload);
    }, 700);
    // Re-render cleanup only cancels the pending timer — the next run re-arms
    // with the newer payload. Do NOT flush here: that would fire a save on every
    // edit and defeat the debounce.
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, shelves]);

  // Unmount-only flush: leaving the page inside the 700ms debounce window would
  // otherwise drop the last edit. The layout save is an idempotent PUT, so a
  // flush that races a just-fired timer is harmless (pendingSave is nulled once
  // the timer runs).
  useEffect(() => {
    return () => {
      if (pendingSave.current) {
        save.mutate(pendingSave.current);
        pendingSave.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemMap = useMemo(() => {
    const m = new Map();
    for (const o of items) m.set(o.id, o);
    return m;
  }, [items]);

  // A piece is "placed" only if it exists AND its shelf is still in range.
  const placedIds = new Set(
    Object.keys(placed).filter(
      (id) => itemMap.has(id) && placed[id].shelf < shelves,
    ),
  );
  const trayItems = items.filter((o) => !placedIds.has(o.id));

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const onDragEnd = ({ active, over }) => {
    setActiveId(null);
    if (!over) return;
    if (over.id === "tray") {
      setPlaced((p) => {
        if (!(active.id in p)) return p;
        const n = { ...p };
        delete n[active.id];
        return n;
      });
      return;
    }
    const shelf = Number(String(over.id).replace("shelf-", ""));
    if (!Number.isInteger(shelf)) return;
    // Project the dragged piece's centre onto the target shelf to get x∈[0,1].
    const ar = active.rect.current.translated;
    const orr = over.rect;
    let x = 0.5;
    if (ar && orr && orr.width) {
      const cx = ar.left + ar.width / 2;
      x = Math.min(0.97, Math.max(0.03, (cx - orr.left) / orr.width));
    }
    setPlaced((p) => ({ ...p, [active.id]: { shelf, x } }));
  };

  const setShelfCount = (n) => {
    const next = Math.max(MIN_SHELVES, Math.min(MAX_SHELVES, n));
    // Removing shelves sends their pieces back to the tray (drop those entries).
    setPlaced((p) => {
      const out = {};
      for (const [id, pos] of Object.entries(p)) {
        if (pos.shelf < next) out[id] = pos;
      }
      return out;
    });
    setShelves(next);
  };

  const activeItem = activeId ? itemMap.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="mt-8">
        {/* Shelf count control + hint */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="micro-tight text-[var(--color-ivoire-soft)]/70 max-w-md">
            {t("vitrines.planner.hint", {
              default:
                "Glisse les pièces du plateau sur les étagères — pose-les où tu veux, à l'échelle réelle.",
            })}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <span className="micro-tight text-[var(--color-ivoire-soft)]/70">
              {t("vitrines.planner.shelves", { default: "Étagères" })}
            </span>
            <button
              type="button"
              onClick={() => setShelfCount(shelves - 1)}
              disabled={shelves <= MIN_SHELVES}
              aria-label={t("vitrines.planner.remove_shelf", { default: "Retirer une étagère" })}
              className="tap-target w-7 h-7 grid place-items-center border border-[var(--color-or)]/35 text-[var(--color-or-pale)] hover:border-[var(--color-or)] disabled:opacity-40 transition-colors"
            >
              −
            </button>
            <span className="font-mono text-[var(--color-ivoire)] w-5 text-center">{shelves}</span>
            <button
              type="button"
              onClick={() => setShelfCount(shelves + 1)}
              disabled={shelves >= MAX_SHELVES}
              aria-label={t("vitrines.planner.add_shelf", { default: "Ajouter une étagère" })}
              className="tap-target w-7 h-7 grid place-items-center border border-[var(--color-or)]/35 text-[var(--color-or-pale)] hover:border-[var(--color-or)] disabled:opacity-40 transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* The case — a stack of lit shelves. */}
        <div
          className="relative overflow-hidden border border-[var(--color-or)]/20 rounded-[3px]"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklab, var(--color-noir-deep) 92%, #000), color-mix(in oklab, var(--color-noir) 82%, #000))",
            boxShadow: "inset 0 0 110px 26px rgba(0,0,0,0.5)",
          }}
        >
          {Array.from({ length: shelves }).map((_, i) => (
            <PlannerShelf
              key={i}
              index={i}
              placed={placed}
              itemMap={itemMap}
              nsfwBlur={nsfwBlur}
              standeeWidthPx={standeeWidthPx}
              activeId={activeId}
            />
          ))}
        </div>

        {/* The tray — unplaced pieces, draggable onto a shelf. */}
        <Tray
          items={trayItems}
          nsfwBlur={nsfwBlur}
          activeId={activeId}
          empty={items.length === 0}
          t={t}
        />
      </div>

      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div style={{ width: standeeWidthPx(activeItem) }}>
            <StandeeImg o={activeItem} nsfwBlur={nsfwBlur} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

/** One lit shelf: a droppable strip with a gold front ledge. Placed pieces are
 *  absolutely positioned along it (left: x%), standing to scale on the ledge. */
function PlannerShelf({ index, placed, itemMap, nsfwBlur, standeeWidthPx, activeId }) {
  const { setNodeRef, isOver } = useDroppable({ id: `shelf-${index}` });
  const mine = Object.entries(placed)
    .filter(([id, pos]) => pos.shelf === index && itemMap.has(id))
    .map(([id, pos]) => ({ id, o: itemMap.get(id), x: pos.x }));
  return (
    <div
      ref={setNodeRef}
      className={`relative transition-colors ${isOver ? "bg-[var(--color-or)]/[0.06]" : ""}`}
      style={{ minHeight: 300 }}
    >
      {/* Spotlight wash from above */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background:
            "radial-gradient(56% 100% at 50% 0, color-mix(in oklab, var(--color-or) 14%, transparent), transparent 72%)",
        }}
      />
      {/* Pieces */}
      {mine.map(({ id, o, x }) => (
        <PlacedStandee
          key={id}
          id={id}
          o={o}
          x={x}
          width={standeeWidthPx(o)}
          nsfwBlur={nsfwBlur}
          hidden={activeId === id}
        />
      ))}
      {/* Front ledge — a gold hairline the pieces rest on */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px"
        style={{
          background:
            "linear-gradient(to right, transparent, color-mix(in oklab, var(--color-or) 70%, transparent) 12%, color-mix(in oklab, var(--color-or) 70%, transparent) 88%, transparent)",
          boxShadow: "0 -1px 16px color-mix(in oklab, var(--color-or) 32%, transparent)",
        }}
      />
    </div>
  );
}

/** A piece placed on a shelf — absolutely positioned at its x, draggable. */
function PlacedStandee({ id, o, x, width, nsfwBlur, hidden }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={o.figure_name}
      className="absolute bottom-[10px] cursor-grab active:cursor-grabbing touch-none"
      style={{
        left: `${x * 100}%`,
        width,
        transform: "translateX(-50%)",
        opacity: hidden ? 0.25 : 1,
        zIndex: hidden ? 1 : 2,
      }}
    >
      <StandeeImg o={o} nsfwBlur={nsfwBlur} />
    </div>
  );
}

/** The bottom tray of un-placed pieces — itself a droppable (drag a placed
 *  piece back here to un-shelf it) holding small draggable thumbnails. */
function Tray({ items, nsfwBlur, activeId, empty, t }) {
  const { setNodeRef, isOver } = useDroppable({ id: "tray" });
  return (
    <div
      ref={setNodeRef}
      className={`mt-4 border border-dashed rounded-[3px] p-4 transition-colors ${
        isOver
          ? "border-[var(--color-or)] bg-[var(--color-or)]/[0.06]"
          : "border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[var(--color-noir-deep)]/50"
      }`}
    >
      <p className="micro-tight mb-3 flex items-center gap-2">
        <span aria-hidden className="ja text-[var(--color-or)]">箱</span>
        {t("vitrines.planner.tray", { default: "Plateau" })}
        <span className="text-[var(--color-ivoire-soft)]/60">· {items.length}</span>
      </p>
      {empty ? (
        <p className="text-[13px] italic text-[var(--color-ivoire-soft)]">
          {t("vitrines.planner.tray_no_items", { default: "Aucune pièce à placer." })}
        </p>
      ) : items.length === 0 ? (
        <p className="text-[13px] italic text-[var(--color-ivoire-soft)]">
          {t("vitrines.planner.tray_all_placed", { default: "Tout est sur les étagères ✓" })}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2.5">
          {items.map((o) => (
            <TrayChip key={o.id} o={o} nsfwBlur={nsfwBlur} hidden={activeId === o.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrayChip({ o, nsfwBlur, hidden }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: o.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      title={o.figure_name}
      className="cursor-grab active:cursor-grabbing touch-none w-[54px] shrink-0"
      style={{ opacity: hidden ? 0.25 : 1 }}
    >
      <StandeeImg o={o} nsfwBlur={nsfwBlur} compact />
    </div>
  );
}

/** Shared standee visual — a 3/4 portrait card (transparent so cutouts show the
 *  shelf behind), type-hue framed, with a kanji fallback. */
function StandeeImg({ o, nsfwBlur, dragging, compact }) {
  const hue = typeHue(o.figure_type);
  const cover = resolveOwnedCover(o);
  const blur = o.is_nsfw && nsfwBlur;
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: "3 / 4",
        border: `1px solid color-mix(in oklab, ${hue} 42%, transparent)`,
        background: compact ? "var(--color-noir-deep)" : "transparent",
        boxShadow: dragging
          ? `0 18px 30px -10px rgba(0,0,0,0.7), 0 0 30px -4px color-mix(in oklab, ${hue} 50%, transparent)`
          : `0 22px 26px -16px rgba(0,0,0,0.8)`,
        transform: dragging ? "rotate(2deg)" : undefined,
      }}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px] z-[2]"
        style={{ background: `linear-gradient(90deg, transparent, ${hue} 30%, ${hue} 70%, transparent)` }}
      />
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          draggable={false}
          // contain + bottom-anchored: the whole figure stays visible, standing
          // on the shelf. cover would crop the head/feet of a tall portrait shot
          // (figure photos are ~0.56 ratio, the frame is 3:4 = 0.75).
          className={`absolute inset-0 w-full h-full object-contain object-bottom ${blur ? "nsfw-blur" : ""}`}
        />
      ) : (
        <span
          aria-hidden
          className="ja absolute inset-0 grid place-items-center"
          style={{ fontSize: compact ? "1.4rem" : "2.2rem", color: `color-mix(in oklab, ${hue} 50%, transparent)` }}
        >
          {typeKanji(o.figure_type)}
        </span>
      )}
    </div>
  );
}
