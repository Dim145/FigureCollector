import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, closestCorners,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, arrayMove, rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useOwnedItems, useLocations, useCreateLocation, useDeleteLocation, useArrangeOwned,
} from "../hooks/useCollection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { fmtMoney, effectiveValue } from "../lib/money.js";
import { resolveOwnedCover } from "../lib/coverUrl.js";

const LOOSE = "__loose__";

function cabinetValue(items) {
  const byCur = new Map();
  for (const it of items) {
    const ev = effectiveValue(it);
    if (!ev) continue;
    const cur = ev.currency || "EUR";
    byCur.set(cur, (byCur.get(cur) || 0) + ev.amount);
  }
  if (byCur.size === 0) return null;
  let best = null;
  for (const [currency, amount] of byCur) if (!best || amount > best.amount) best = { currency, amount };
  return { ...best, multi: byCur.size > 1 };
}

/**
 * « Les Vitrines » — drag-and-drop shelf organiser (@dnd-kit), redrawn to
 * Direction A ("Shōjo-Noir").
 *
 * Each cabinet reads like a lit glass display case: a Card surface with a
 * brass-plaque header, a kanji marker (棚 registered / 飾 free-text), gold-rule
 * shelf edges framing the specimens, and a quiet diagonal sheen. A figurine-
 * metric strip (vitrines · rangées · non rangées · valeur) sits under the
 * editorial header; the « où est… ? » lookup is a refined Card-bordered
 * control with a 探 marker.
 *
 * Pieces live in persistent display cabinets (`collection_locations`) plus any
 * free-text location typed before it was registered, plus a dashed "unshelved"
 * group. Cabinets can be created/deleted; pieces are reordered WITHIN a shelf
 * and moved BETWEEN shelves by dragging the card (pointer, touch, keyboard),
 * persisted via the `arrange` endpoint. Covers show the figure photo (kanji
 * glyph fallback), NSFW-blurred per the viewer's preference.
 *
 * GPU-light: flat fills + static gradients + hairlines, the shared `.reveal`
 * stagger, the one diagonal glass sheen. No animated meshes / blur / glows.
 */
export default function VitrinesPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const locations = useLocations();
  const createLoc = useCreateLocation();
  const delLoc = useDeleteLocation();
  const arrange = useArrangeOwned();

  const locale = document.documentElement.lang || undefined;
  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";

  const itemMap = useMemo(() => {
    const m = new Map();
    for (const o of owned.data ?? []) m.set(o.id, o);
    return m;
  }, [owned.data]);

  // Canonical board derived from server truth: registry order + orphan
  // locations + loose, each sorted by sort_order (nulls last → created_at).
  const canonical = useMemo(() => {
    const items = owned.data ?? [];
    const registry = locations.data ?? [];
    const sortIds = (arr) =>
      [...arr]
        .sort((a, b) => {
          if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order;
          if (a.sort_order != null) return -1;
          if (b.sort_order != null) return 1;
          return a.created_at < b.created_at ? 1 : -1;
        })
        .map((o) => o.id);

    // Cabinets are matched CASE-INSENSITIVELY (the registry's unique index is on
    // lower(name)). Canonical display name = the registry's casing when it
    // exists, else the first location casing seen — so a registry "chambre"
    // merges with items located in "Chambre" instead of showing two cabinets.
    const displayByKey = new Map(); // lowerKey → display name
    const registeredIds = new Map(); // display name → location id
    for (const r of registry) {
      const key = r.name.trim().toLowerCase();
      if (!displayByKey.has(key)) displayByKey.set(key, r.name.trim());
      registeredIds.set(displayByKey.get(key), r.id);
    }
    const byKey = new Map(); // lowerKey → items[]
    const loose = [];
    for (const o of items) {
      const loc = (o.location || "").trim();
      if (!loc) {
        loose.push(o);
        continue;
      }
      const key = loc.toLowerCase();
      if (!displayByKey.has(key)) displayByKey.set(key, loc);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(o);
    }
    // Registry order first, then orphan locations (items only), then loose.
    const orderedKeys = [];
    const seen = new Set();
    for (const r of registry) {
      const key = r.name.trim().toLowerCase();
      if (!seen.has(key)) { seen.add(key); orderedKeys.push(key); }
    }
    for (const key of byKey.keys()) {
      if (!seen.has(key)) { seen.add(key); orderedKeys.push(key); }
    }
    const board = {};
    const order = [];
    for (const key of orderedKeys) {
      const name = displayByKey.get(key);
      board[name] = sortIds(byKey.get(key) ?? []);
      order.push(name);
    }
    board[LOOSE] = sortIds(loose);
    order.push(LOOSE);
    return { order, board, registeredIds };
  }, [owned.data, locations.data]);

  const [board, setBoard] = useState(canonical.board);
  const [order, setOrder] = useState(canonical.order);
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setBoard(canonical.board);
    setOrder(canonical.order);
  }, [canonical]);

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matched = useMemo(
    () => (q ? (owned.data ?? []).filter((o) => o.figure_name.toLowerCase().includes(q)) : null),
    [owned.data, q],
  );
  const matchedIds = useMemo(() => new Set((matched ?? []).map((o) => o.id)), [matched]);

  // create / delete cabinet
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const submitCreate = () => {
    const n = newName.trim();
    if (!n) { setCreating(false); return; }
    createLoc.mutate(n, { onSuccess: () => { setNewName(""); setCreating(false); } });
  };
  const [confirmDel, setConfirmDel] = useState(null);

  // ── Drag and drop ──────────────────────────────────────────────────────
  // The WHOLE card is draggable. Mouse: drag after an 8px move (a click below
  // that threshold navigates). Touch: long-press (200ms) to drag, so taps
  // navigate and swipes still scroll the page (no touch-action:none).
  // Keyboard: Space lifts/drops + arrows reorder; Enter opens the figure
  // (KeyboardSensor restricted to Space so Enter stays free for navigation).
  const navigate = useNavigate();
  const clickGuardRef = useRef(false); // suppress the click that trails a drag
  const openItem = (o) => {
    if (clickGuardRef.current) return;
    navigate(`/figures/${o.figure_id}`);
  };
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );
  const [activeId, setActiveId] = useState(null);
  const findContainer = (id) => {
    if (id == null) return null;
    if (id in board) return id;
    return order.find((k) => board[k]?.includes(id)) ?? null;
  };
  const persist = (key, ids) =>
    arrange.mutate({ location: key === LOOSE ? "" : key, ordered_ids: ids });

  const onDragStart = ({ active }) => {
    draggingRef.current = true;
    clickGuardRef.current = true;
    setActiveId(active.id);
  };
  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const from = findContainer(active.id);
    const to = findContainer(over.id);
    if (!from || !to || from === to) return;
    setBoard((prev) => {
      const fromIds = prev[from].filter((i) => i !== active.id);
      const overIsContainer = over.id in prev;
      const overIdx = overIsContainer ? prev[to].length : prev[to].indexOf(over.id);
      const insertAt = overIdx < 0 ? prev[to].length : overIdx;
      const toIds = [...prev[to]];
      toIds.splice(insertAt, 0, active.id);
      return { ...prev, [from]: fromIds, [to]: toIds };
    });
  };
  const onDragEnd = ({ active, over }) => {
    draggingRef.current = false;
    setActiveId(null);
    // Keep the click guard up past the trailing click that follows a drag.
    setTimeout(() => { clickGuardRef.current = false; }, 0);
    if (!over) { setBoard(canonical.board); return; }
    const container = findContainer(active.id);
    if (!container) { setBoard(canonical.board); return; }
    let finalIds = board[container];
    if (
      findContainer(over.id) === container &&
      active.id !== over.id &&
      !(over.id in board)
    ) {
      finalIds = arrayMove(
        board[container],
        board[container].indexOf(active.id),
        board[container].indexOf(over.id),
      );
      setBoard((prev) => ({ ...prev, [container]: finalIds }));
    }
    persist(container, finalIds);
  };
  const onDragCancel = () => {
    draggingRef.current = false;
    setActiveId(null);
    setTimeout(() => { clickGuardRef.current = false; }, 0);
    setBoard(canonical.board);
  };

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const total = owned.data?.length ?? 0;
  const cabinetKeys = order.filter((k) => k !== LOOSE);
  const activeItem = activeId ? itemMap.get(activeId) : null;
  const tileShared = { nsfwBlur, matchedIds, openItem, t };

  // Header metric strip (figurine metrics only — counts stay ivoire/red, gold
  // is reserved for the aggregate value). Derived from the live board so the
  // figures track drags optimistically.
  const looseCount = (board[LOOSE] ?? []).length;
  const shelvedCount = total - looseCount;
  const totalValue = cabinetValue(owned.data ?? []);

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-0 right-0 h-[380px] -z-0"
          style={{
            background:
              "radial-gradient(46% 62% at 18% 0%, color-mix(in oklab, var(--color-indigo) 16%, transparent), transparent 70%), radial-gradient(44% 58% at 86% 6%, color-mix(in oklab, var(--color-or) 16%, transparent), transparent 72%)",
            WebkitMaskImage: "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage: "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />

        {/* ─── Editorial header ─── */}
        <header className="relative mb-12">
          <span aria-hidden className="kanji-mark text-[24rem] -top-28 -right-6 hidden md:block">棚</span>

          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("vitrines.eyebrow")}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">棚</span>
          </p>
          <h1
            className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("vitrines.title")} />
          </h1>
          <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />
          <p
            className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl reveal"
            style={{ "--i": 3 }}
          >
            {t("vitrines.body")}
          </p>

          {total > 0 || cabinetKeys.length > 0 ? (
            <div
              className="mt-8 grid grid-cols-2 lg:grid-cols-4 gap-3 reveal"
              style={{ "--i": 3 }}
            >
              <StatCard
                label={t("nav.vitrines")}
                value={cabinetKeys.length}
                sub={t("vitrines.stat.cabinets_sub", { default: "Meubles" })}
              />
              <StatCard
                label={t("vitrines.stat.shelved", { default: "Pièces rangées" })}
                value={shelvedCount}
              />
              <StatCard
                label={t("vitrines.stat.loose", { default: "Non rangées" })}
                value={looseCount}
                tone={looseCount > 0 ? "red" : undefined}
              />
              <StatCard
                label={t("vitrines.stat.value", { default: "Valeur en vitrine" })}
                value={totalValue ? `${totalValue.multi ? "≈ " : ""}${fmtMoney(totalValue.amount, totalValue.currency, locale)}` : "—"}
                tone="gold"
              />
            </div>
          ) : null}
        </header>

        {/* ─── « Où est… ? » lookup + cabinet creation — a refined A control ─── */}
        <Reveal as="div" delay={0.05}>
          <Card className="relative overflow-hidden p-4 md:p-5">
            <span aria-hidden className="kanji-mark text-[8rem] -top-6 -right-2 select-none">探</span>
            <div className="relative flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-3 flex-1 min-w-[16rem] border border-[color-mix(in_oklab,var(--color-or)_45%,transparent)] focus-within:border-[var(--color-or)] bg-[var(--color-noir-deep)] px-4 py-2.5 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4 text-[var(--color-or)] shrink-0" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("vitrines.search_ph")}
                  aria-label={t("vitrines.search_ph")}
                  className="flex-1 bg-transparent outline-none text-[var(--color-ivoire)] display text-xl placeholder:text-[color-mix(in_oklab,var(--color-ivoire)_45%,transparent)]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label={t("vitrines.search_clear", { default: "Effacer" })}
                    className="tap-target shrink-0 -mr-2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors leading-none text-lg"
                  >
                    ×
                  </button>
                ) : null}
              </label>
              {creating ? (
                <span className="inline-flex items-center border border-[var(--color-or)] bg-[var(--color-noir-deep)]">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setCreating(false); }}
                    placeholder={t("vitrines.new_cabinet_ph")}
                    aria-label={t("vitrines.new_cabinet_ph")}
                    className="bg-transparent outline-none text-[var(--color-ivoire)] px-3 py-2.5 w-44"
                  />
                  <button type="button" onClick={submitCreate} disabled={createLoc.isPending} className="tap-target px-3 self-stretch bg-[var(--color-laque)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.16em] hover:bg-[var(--color-laque-bright)] transition-colors disabled:opacity-60">
                    {t("vitrines.create")}
                  </button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setCreating(true)} className="!px-5 !py-2.5 text-[11px] uppercase tracking-[0.18em] whitespace-nowrap">
                  <span aria-hidden className="ja text-[var(--color-or)] text-base leading-none">飾</span>
                  {t("vitrines.new_cabinet")}
                </Button>
              )}
            </div>

            {matched ? (
              <p className="relative mt-3 pt-3 border-t border-[color-mix(in_oklab,var(--color-or)_18%,transparent)] text-[13px] text-[var(--color-ivoire-soft)]">
                {matched.length === 0 ? (
                  <span className="italic">{t("vitrines.search_none", { q: query.trim() })}</span>
                ) : (
                  <>
                    <span className="micro-tight mr-1.5 text-[var(--color-or-pale)]">{t("vitrines.search_found", { n: matched.length })}</span>
                    {matched.slice(0, 4).map((o, i) => (
                      <span key={o.id} className="whitespace-nowrap">
                        {i > 0 ? <span aria-hidden className="text-[color-mix(in_oklab,var(--color-or)_45%,transparent)]"> · </span> : ""}
                        <b className="text-[var(--color-jade)] font-medium">{o.figure_name}</b>
                        <span className="text-[var(--color-or-pale)]"> 「{(o.location || "").trim() || t("vitrines.loose")}」</span>
                      </span>
                    ))}
                    {matched.length > 4 ? <span aria-hidden className="text-[var(--color-ivoire-soft)]"> …</span> : ""}
                  </>
                )}
              </p>
            ) : null}
          </Card>
        </Reveal>

        {owned.isLoading ? (
          <p role="status" aria-live="polite" className="text-center text-[var(--color-ivoire-soft)] py-16">…</p>
        ) : total === 0 && cabinetKeys.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div className="mt-8 grid gap-7 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {cabinetKeys.map((key) => (
                <Cabinet
                  key={key}
                  id={key}
                  name={key}
                  ids={board[key] ?? []}
                  itemMap={itemMap}
                  locale={locale}
                  registered={canonical.registeredIds.has(key)}
                  onDelete={
                    canonical.registeredIds.has(key)
                      ? () => setConfirmDel({ id: canonical.registeredIds.get(key), name: key })
                      : null
                  }
                  {...tileShared}
                />
              ))}
              {total > 0 ? (
                <Cabinet id={LOOSE} loose ids={board[LOOSE] ?? []} itemMap={itemMap} locale={locale} {...tileShared} />
              ) : null}
            </div>
            <DragOverlay>
              {activeItem ? (
                <div
                  className="relative aspect-[3/4] w-[var(--ov-w,120px)] overflow-hidden border shadow-2xl rotate-2"
                  style={{ borderColor: `color-mix(in oklab, ${typeHue(activeItem.figure_type)} 50%, transparent)`, background: "var(--color-noir-deep)" }}
                >
                  <TileVisual o={activeItem} nsfwBlur={nsfwBlur} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {confirmDel ? (
        <ConfirmDialog
          open
          title={t("vitrines.delete_cabinet")}
          body={t("vitrines.delete_confirm", { name: confirmDel.name })}
          confirmLabel={t("vitrines.delete_cabinet")}
          destructive
          busy={delLoc.isPending}
          onConfirm={() => { delLoc.mutate(confirmDel.id); setConfirmDel(null); }}
          onCancel={() => setConfirmDel(null)}
        />
      ) : null}
    </AppShell>
  );
}

/**
 * One display case. Registered + free-text cabinets read as a lit glass
 * vitrine (Card surface, brass-plaque header, kanji marker, gold-rule shelf
 * edges, glass sheen); the "unshelved" group is a dashed reserve crate.
 *
 * The droppable + SortableContext wiring is unchanged — only the chrome around
 * the specimen grid was restyled.
 */
function Cabinet({ id, name, loose, ids, itemMap, locale, registered, onDelete, nsfwBlur, matchedIds, openItem, t }) {
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
              items.map((o) => <SortableTile key={o.id} o={o} nsfwBlur={nsfwBlur} matchedIds={matchedIds} openItem={openItem} />)
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
      <span aria-hidden className="kanji-mark text-[7rem] -top-5 -right-1 select-none">{marker}</span>
      <GlassSheen />

      {/* Brass plaque — the cabinet's name + a kanji tag, over the front
          gold-rule shelf edge. */}
      <header className="relative z-[2] flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0">
          <p className="micro-tight flex items-center gap-1.5">
            <span aria-hidden className="ja not-italic text-sm leading-none text-[var(--color-or)]">{marker}</span>
            {registered ? t("vitrines.cabinet_kicker", { default: "Meuble" }) : t("vitrines.cabinet_kicker_freetext", { default: "Emplacement" })}
          </p>
          <h2 className="display text-xl leading-tight truncate text-[var(--color-ivoire)] mt-1">
            {name}
          </h2>
          <p className="micro-tight mt-1 text-[var(--color-ivoire-soft)]/70">{t("vitrines.piece_count", { n: items.length })}</p>
        </div>
        <div className="flex items-start gap-2 shrink-0">
          <CabinetValue items={items} locale={locale} t={t} />
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              title={t("vitrines.delete_cabinet")}
              className="tap-target -mr-1.5 -mt-1 grid place-items-center text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors leading-none text-lg"
            >
              ×<span className="sr-only">{t("vitrines.delete_cabinet")}</span>
            </button>
          ) : null}
        </div>
      </header>
      {/* Front shelf edge — a gold hairline under the plaque. */}
      <div aria-hidden className="relative z-[2] gold-rule mx-4" />

      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div ref={setNodeRef} className="relative z-[1] grid grid-cols-3 gap-2.5 px-4 pt-4 pb-3 min-h-[96px]">
          {items.length === 0 ? (
            <DropHint t={t} />
          ) : (
            items.map((o) => <SortableTile key={o.id} o={o} nsfwBlur={nsfwBlur} matchedIds={matchedIds} openItem={openItem} />)
          )}
        </div>
      </SortableContext>
      {/* Base shelf edge — a fainter gold rule grounding the case. */}
      <div aria-hidden className="relative z-[2] mx-4 mb-3 h-px" style={{ background: "linear-gradient(to right, transparent, color-mix(in oklab, var(--color-or) 45%, transparent) 30%, color-mix(in oklab, var(--color-or) 45%, transparent) 70%, transparent)" }} />
    </Card>
  );
}

// Empty-shelf affordance — a centred, dashed-feeling cue inviting a drop. The
// kanji whispers "place" (置). Spans the 3-column specimen grid.
function DropHint({ t }) {
  return (
    <div className="col-span-3 grid place-items-center text-center py-7 gap-1.5">
      <span aria-hidden className="ja text-2xl leading-none text-[color-mix(in_oklab,var(--color-or)_35%,transparent)]">置</span>
      <p className="text-[12px] text-[var(--color-ivoire-soft)] italic">{t("vitrines.drop_hint")}</p>
    </div>
  );
}

function SortableTile({ o, nsfwBlur, matchedIds, openItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: o.id });
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
        background: "radial-gradient(circle at 30% 18%, var(--color-noir-soft) 0%, var(--color-noir-deep) 60%)",
      }}
      className={`group/spec relative aspect-[3/4] overflow-hidden border cursor-grab active:cursor-grabbing select-none ${isMatch ? "ring-2 ring-[var(--color-jade)] ring-offset-1 ring-offset-[var(--color-noir-deep)]" : ""}`}
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

function TileVisual({ o, nsfwBlur }) {
  const hue = typeHue(o.figure_type);
  const cover = resolveOwnedCover(o);
  const blur = o.is_nsfw && nsfwBlur;
  return (
    <>
      <span aria-hidden className="absolute top-0 left-0 right-0 h-[2px] z-[2]" style={{ background: `linear-gradient(90deg, transparent, ${hue} 30%, ${hue} 70%, transparent)` }} />
      {cover ? (
        <img src={cover} alt="" loading="lazy" draggable={false} className={`absolute inset-0 w-full h-full object-cover ${blur ? "nsfw-blur" : ""}`} />
      ) : (
        <span aria-hidden className="ja absolute inset-0 grid place-items-center text-[2.2rem]" style={{ color: `color-mix(in oklab, ${hue} 50%, transparent)` }}>
          {typeKanji(o.figure_type)}
        </span>
      )}
      <span className="absolute left-0 right-0 bottom-0 z-[2] px-1.5 py-1 text-[8.5px] text-center text-[var(--color-ivoire)] [background:linear-gradient(to_top,color-mix(in_oklab,var(--color-noir-deep)_92%,transparent),transparent)] truncate">
        {o.figure_name}
      </span>
    </>
  );
}

function CabinetValue({ items, locale, t }) {
  const v = cabinetValue(items);
  if (!v) return null;
  return (
    <div className="text-right">
      <div className="display text-lg text-[var(--color-or-pale)] whitespace-nowrap">{v.multi ? "≈ " : ""}{fmtMoney(v.amount, v.currency, locale)}</div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] mt-0.5">{t("vitrines.cabinet_value")}</div>
    </div>
  );
}

function GlassSheen() {
  return (
    <span aria-hidden className="absolute inset-0 z-[3] pointer-events-none" style={{ background: "linear-gradient(118deg, transparent 38%, oklch(1 0 0 / 0.05) 49%, transparent 60%)" }} />
  );
}

function EmptyState({ t }) {
  return (
    <Card className="max-w-xl mx-auto mt-8 p-12 text-center relative overflow-hidden frame-corners">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none"
      >
        棚
      </span>
      <p className="micro relative">{t("vitrines.empty_eyebrow", { default: "Aucune vitrine" })}</p>
      <h2 className="display text-3xl mt-3 text-[var(--color-ivoire)] relative">
        {t("vitrines.empty")}
      </h2>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("vitrines.empty_body", { default: "Ajoute des pièces à ta collection, puis range-les dans des vitrines en les glissant à leur place." })}
      </p>
      <div className="gold-rule mx-auto w-20 my-8" />
      <Link to="/collection" className="relative inline-block">
        <Button variant="primary">{t("vitrines.empty_cta")}</Button>
      </Link>
    </Card>
  );
}
