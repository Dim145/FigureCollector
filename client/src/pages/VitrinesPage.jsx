import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useOwnedItems,
  useLocations,
  useCreateLocation,
  useDeleteLocation,
  useArrangeOwned,
} from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import { PageLayout, Section } from "../components/layout/index.js";
import { Button, EmptyState } from "../components/ui/index.js";
import { SectionSkeleton } from "../components/Skeleton.jsx";
import ErrorState from "../components/ErrorState.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ShelfPlanner from "../components/ShelfPlanner.jsx";
import { typeHue } from "../lib/typeHue.js";
import { standeeWidthPx } from "../lib/standee.js";
import VitrinesKpiStrip from "./vitrines/VitrinesKpiStrip.jsx";
import VitrineLookup from "./vitrines/VitrineLookup.jsx";
import Cabinet, { cabinetValue } from "./vitrines/Cabinet.jsx";
import DioramaShelf from "./vitrines/DioramaShelf.jsx";
import { TileVisual } from "./vitrines/VitrineTile.jsx";

const LOOSE = "__loose__";

/**
 * « Les Vitrines » — drag-and-drop shelf organiser (@dnd-kit), on the shared
 * foundation, Direction A ("Shōjo-Noir").
 *
 * Thin orchestrator: owns the data hooks, the dnd state machine, and the
 * view/query/create state, and composes the page-local cabinet / lookup /
 * diorama sub-components inside PageLayout. Pieces live in persistent display
 * cabinets (`collection_locations`) plus any free-text location typed before it
 * was registered, plus a dashed "unshelved" group. Cabinets can be
 * created/deleted; pieces are reordered WITHIN a shelf and moved BETWEEN
 * shelves by dragging the card (pointer, touch, keyboard), persisted via the
 * `arrange` endpoint. ALL drag-and-drop logic is preserved verbatim.
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
    const shareByName = new Map(); // display name → share_token (or null)
    for (const r of registry) {
      const key = r.name.trim().toLowerCase();
      if (!displayByKey.has(key)) displayByKey.set(key, r.name.trim());
      registeredIds.set(displayByKey.get(key), r.id);
      shareByName.set(displayByKey.get(key), r.share_token ?? null);
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
      if (!seen.has(key)) {
        seen.add(key);
        orderedKeys.push(key);
      }
    }
    for (const key of byKey.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        orderedKeys.push(key);
      }
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
    return { order, board, registeredIds, shareByName };
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
  const [view, setView] = useState("grid"); // "grid" (drag-arrange) | "diorama" (display) | "plan"
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
    if (!n) {
      setCreating(false);
      return;
    }
    createLoc.mutate(n, {
      onSuccess: () => {
        setNewName("");
        setCreating(false);
      },
    });
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
    setTimeout(() => {
      clickGuardRef.current = false;
    }, 0);
    if (!over) {
      setBoard(canonical.board);
      return;
    }
    const container = findContainer(active.id);
    if (!container) {
      setBoard(canonical.board);
      return;
    }
    let finalIds = board[container];
    if (findContainer(over.id) === container && active.id !== over.id && !(over.id in board)) {
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
    setTimeout(() => {
      clickGuardRef.current = false;
    }, 0);
    setBoard(canonical.board);
  };

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (owned.isError) {
    return (
      <AppShell>
        <PageLayout width="wide">
          <ErrorState error={owned.error} onRetry={() => owned.refetch()} />
        </PageLayout>
      </AppShell>
    );
  }

  const total = owned.data?.length ?? 0;
  const cabinetKeys = order.filter((k) => k !== LOOSE);
  const activeItem = activeId ? itemMap.get(activeId) : null;
  const tileShared = { nsfwBlur, matchedIds, openItem, t };
  const hasBoard = total > 0 || cabinetKeys.length > 0;

  // Header metric strip (figurine metrics only — counts neutral, gold reserved
  // for the aggregate value). Derived from the live board so the figures track
  // drags optimistically.
  const looseCount = (board[LOOSE] ?? []).length;
  const shelvedCount = total - looseCount;
  const totalValue = cabinetValue(owned.data ?? []);

  // Single primary CTA → opens the inline create-cabinet field in the lookup.
  const startCreate = () => setCreating(true);

  return (
    <AppShell>
      <PageLayout
        kicker={t("vitrines.kicker", { default: "COLLECTION · 棚 · VITRINES" })}
        title={t("vitrines.title")}
        kanji="棚"
        width="wide"
        toolbar={
          hasBoard ? (
            <Button
              variant="primary"
              size="sm"
              iconStart={<Plus size={16} />}
              className="uppercase"
              onClick={startCreate}
            >
              {t("vitrines.new_cabinet")}
            </Button>
          ) : null
        }
      >
        <p className="text-[var(--on-surface-muted)] leading-relaxed max-w-2xl -mt-2 mb-2">
          {t("vitrines.body")}
        </p>

        {owned.isLoading ? (
          <SectionSkeleton />
        ) : total === 0 && cabinetKeys.length === 0 ? (
          <EmptyState
            kanji="棚"
            eyebrow={t("vitrines.empty_eyebrow", { default: "Aucune vitrine" })}
            title={t("vitrines.empty")}
            body={t("vitrines.empty_body", {
              default:
                "Ajoute des pièces à ta collection, puis range-les dans des vitrines en les glissant à leur place.",
            })}
          >
            <Button as={Link} to="/collection" variant="primary">
              {t("vitrines.empty_cta")}
            </Button>
          </EmptyState>
        ) : (
          <>
            <VitrinesKpiStrip
              t={t}
              cabinets={cabinetKeys.length}
              shelved={shelvedCount}
              loose={looseCount}
              totalValue={totalValue}
            />

            <div className="mt-8">
              <VitrineLookup
                t={t}
                query={query}
                onQuery={setQuery}
                matched={matched}
                creating={creating}
                newName={newName}
                onNewName={setNewName}
                onStartCreate={startCreate}
                onSubmitCreate={submitCreate}
                onCancelCreate={() => setCreating(false)}
                createPending={createLoc.isPending}
              />
            </div>

            <Section
              className="mt-8"
              kicker={t("vitrines.section.organise", { default: "Organiser les meubles" })}
              actions={
                <div className="flex items-center gap-2.5">
                  <span className="micro-tight text-[var(--on-surface-muted)]">
                    {t("vitrines.view", { default: "Vue" })}
                  </span>
                  <div
                    className="view-toggle"
                    role="group"
                    aria-label={t("vitrines.view", { default: "Vue" })}
                  >
                    <button
                      type="button"
                      className={view === "grid" ? "is-on" : ""}
                      aria-pressed={view === "grid"}
                      onClick={() => setView("grid")}
                    >
                      {t("vitrines.view.grid", { default: "Grille" })}
                    </button>
                    <button
                      type="button"
                      className={view === "diorama" ? "is-on" : ""}
                      aria-pressed={view === "diorama"}
                      onClick={() => setView("diorama")}
                    >
                      {t("vitrines.view.diorama", { default: "Diorama" })}
                    </button>
                    <button
                      type="button"
                      className={view === "plan" ? "is-on" : ""}
                      aria-pressed={view === "plan"}
                      onClick={() => setView("plan")}
                    >
                      {t("vitrines.view.plan", { default: "Atelier" })}
                    </button>
                  </div>
                </div>
              }
              divider
            >
              {view === "plan" ? (
                <ShelfPlanner
                  items={owned.data ?? []}
                  nsfwBlur={nsfwBlur}
                  standeeWidthPx={standeeWidthPx}
                  t={t}
                />
              ) : view === "diorama" ? (
                <div className="space-y-12">
                  {cabinetKeys.map((key) => (
                    <DioramaShelf
                      key={key}
                      name={key}
                      marker={canonical.registeredIds.has(key) ? "棚" : "飾"}
                      items={(board[key] ?? []).map((i) => itemMap.get(i)).filter(Boolean)}
                      {...tileShared}
                    />
                  ))}
                  {(board[LOOSE] ?? []).length ? (
                    <DioramaShelf
                      name={t("vitrines.loose")}
                      marker="箱"
                      items={(board[LOOSE] ?? []).map((i) => itemMap.get(i)).filter(Boolean)}
                      {...tileShared}
                    />
                  ) : null}
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCorners}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDragEnd={onDragEnd}
                  onDragCancel={onDragCancel}
                >
                  <div className="grid gap-7 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
                    {cabinetKeys.map((key) => (
                      <Cabinet
                        key={key}
                        id={key}
                        name={key}
                        ids={board[key] ?? []}
                        itemMap={itemMap}
                        registered={canonical.registeredIds.has(key)}
                        cabinetDbId={canonical.registeredIds.get(key) ?? null}
                        shareToken={canonical.shareByName.get(key) ?? null}
                        onDelete={
                          canonical.registeredIds.has(key)
                            ? () =>
                                setConfirmDel({ id: canonical.registeredIds.get(key), name: key })
                            : null
                        }
                        {...tileShared}
                      />
                    ))}
                    {total > 0 ? (
                      <Cabinet
                        id={LOOSE}
                        loose
                        ids={board[LOOSE] ?? []}
                        itemMap={itemMap}
                        {...tileShared}
                      />
                    ) : null}
                  </div>
                  <DragOverlay>
                    {activeItem ? (
                      <div
                        className="relative aspect-[3/4] w-[var(--ov-w,120px)] overflow-hidden border shadow-2xl rotate-2"
                        style={{
                          borderColor: `color-mix(in oklab, ${typeHue(activeItem.figure_type)} 50%, transparent)`,
                          background: "var(--color-noir-deep)",
                        }}
                      >
                        <TileVisual o={activeItem} nsfwBlur={nsfwBlur} />
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              )}
            </Section>
          </>
        )}
      </PageLayout>

      {confirmDel ? (
        <ConfirmDialog
          open
          title={t("vitrines.delete_cabinet")}
          body={t("vitrines.delete_confirm", { name: confirmDel.name })}
          confirmLabel={t("vitrines.delete_cabinet")}
          destructive
          busy={delLoc.isPending}
          onConfirm={() => {
            delLoc.mutate(confirmDel.id);
            setConfirmDel(null);
          }}
          onCancel={() => setConfirmDel(null)}
        />
      ) : null}
    </AppShell>
  );
}
