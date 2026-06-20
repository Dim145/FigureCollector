import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { typeHue, typeKanji } from "../../lib/typeHue.js";
import { resolveOwnedCover } from "../../lib/coverUrl.js";

/**
 * The visual content of a specimen tile (type hairline, cover/kanji fallback,
 * name caption). Shared by the in-grid sortable tile and the DragOverlay clone
 * so the dragged card matches its resting state exactly.
 */
export function TileVisual({ o, nsfwBlur }) {
  const hue = typeHue(o.figure_type);
  const cover = resolveOwnedCover(o);
  const blur = o.is_nsfw && nsfwBlur;
  return (
    <>
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px] z-[2]"
        style={{
          background: `linear-gradient(90deg, transparent, ${hue} 30%, ${hue} 70%, transparent)`,
        }}
      />
      {cover ? (
        <img
          src={cover}
          alt=""
          loading="lazy"
          draggable={false}
          className={`absolute inset-0 w-full h-full object-cover ${blur ? "nsfw-blur" : ""}`}
        />
      ) : (
        <span
          aria-hidden
          className="ja absolute inset-0 grid place-items-center text-[2.2rem]"
          style={{ color: `color-mix(in oklab, ${hue} 50%, transparent)` }}
        >
          {typeKanji(o.figure_type)}
        </span>
      )}
      <span className="absolute left-0 right-0 bottom-0 z-[2] px-1.5 py-1 text-[8.5px] text-center text-[var(--color-ivoire)] [background:linear-gradient(to_top,color-mix(in_oklab,var(--color-noir-deep)_92%,transparent),transparent)] truncate">
        {o.figure_name}
      </span>
    </>
  );
}

/**
 * One draggable specimen inside a cabinet. The whole tile carries the drag
 * listeners (pointer/touch/keyboard); a click navigates to the figure. The
 * useSortable wiring and the Enter-vs-Space keyboard split are unchanged from
 * the original page — only structure (extraction) changed.
 */
export function SortableTile({ o, nsfwBlur, matchedIds, openItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: o.id,
  });
  const hue = typeHue(o.figure_type);
  const isMatch = matchedIds.has(o.id);
  // The whole card carries the drag listeners. Keep @dnd-kit's keyboard handler
  // (Space lifts/drops) but compose our own so Enter opens the figure.
  const { onKeyDown: dndKeyDown, ...dragListeners } = listeners ?? {};
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...dragListeners}
      onClick={() => openItem(o)}
      onKeyDown={(e) => {
        dndKeyDown?.(e);
        if (!e.defaultPrevented && e.key === "Enter") {
          e.preventDefault();
          openItem(o);
        }
      }}
      title={o.figure_name}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        borderColor: `color-mix(in oklab, ${hue} 26%, transparent)`,
        background:
          "radial-gradient(circle at 30% 18%, var(--color-noir-soft) 0%, var(--color-noir-deep) 60%)",
        // Casts a soft shadow at its foot — the specimen "rests" on the glass
        // shelf rather than floating in the grid.
        boxShadow:
          "0 7px 11px -8px color-mix(in oklab, var(--color-noir-deep) 95%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-ivoire) 5%, transparent)",
      }}
      className={`group/spec relative aspect-[3/4] overflow-hidden border cursor-grab active:cursor-grabbing select-none ${
        isMatch
          ? "ring-2 ring-[var(--color-jade)] ring-offset-1 ring-offset-[var(--color-noir-deep)]"
          : ""
      }`}
    >
      <TileVisual o={o} nsfwBlur={nsfwBlur} />
      {/* Grab affordance — a faint ⠿ handle cue that surfaces on hover/focus.
          Purely decorative; the whole tile is draggable. */}
      <span
        aria-hidden
        className="absolute top-1 right-1 z-[3] leading-none text-[10px] text-[var(--color-ivoire)] opacity-0 group-hover/spec:opacity-70 group-focus/spec:opacity-70 transition-opacity"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}
      >
        ⠿
      </span>
    </div>
  );
}
