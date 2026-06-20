import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, Pencil, Search, Table2, Trash2 } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useAdminFigures, useBulkDeleteFigures, useDeleteFigure } from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import { resolveFigureCover } from "../lib/coverUrl.js";
import { typeKanji } from "../lib/typeHue.js";
import {
  Badge,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Pagination,
  SegmentedControl,
  StatCard,
} from "../components/ui/index.js";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FigureCard from "../components/FigureCard.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import AdminSectionHeader from "./admin/AdminSectionHeader.jsx";
import { selectionBridge } from "./admin/selectionBridge.js";
import { useClientSort } from "./admin/useClientSort.js";
import { useClientPagination } from "./admin/useClientPagination.js";

/**
 * /admin/figures — moderation of the whole catalogue, on the shared foundation.
 *
 * Renders inside AdminLayout's <Outlet/>, below the global "Administration" h1.
 * Anatomy: AdminSectionHeader (kicker · 像 · CATALOGUE) → StatCard strip derived
 * purely from the loaded rows → a filter / view bar (shared <Input> search + a
 * <SegmentedControl> table↔grid toggle) → the catalogue itself.
 *
 *   - Table view = the shared <DataTable> (sortable, row-selection wired to the
 *     existing `useRowSelection`, shared EmptyState, client-side Pagination).
 *   - Grid view = the FigureCard vitrine with an overlaid selection box + admin
 *     action rail per specimen.
 *
 * Both views share the SAME `useRowSelection` store + bulk-delete, so the
 * floating BulkActionBar works identically and multi-select survives a flip.
 * Every data hook, mutation, the search filter, and the edit dialog are
 * untouched; delete now routes through the shared ConfirmDialog. GPU-light.
 */
export default function AdminFiguresPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const figures = useAdminFigures({ q });
  const [view, setView] = useState("table"); // "table" | "grid" — presentation only
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const del = useDeleteFigure();
  const bulkDel = useBulkDeleteFigures();

  const rows = useMemo(() => figures.data ?? [], [figures.data]);
  const ids = useMemo(() => rows.map((f) => f.id), [rows]);
  const sel = useRowSelection(ids);

  // Glanceable catalogue counts — derived from the rows already in hand so the
  // strip costs nothing extra. Gold marks the headline catalogue figure,
  // --primary flags the NSFW pieces moderation most cares about.
  const counts = useMemo(() => {
    const types = new Set();
    const makers = new Set();
    let nsfw = 0;
    for (const f of rows) {
      if (f.figure_type) types.add(f.figure_type);
      if (f.manufacturer_name) makers.add(f.manufacturer_name);
      if (f.is_nsfw) nsfw += 1;
    }
    return { total: rows.length, types: types.size, makers: makers.size, nsfw };
  }, [rows]);

  const { sort, onSort, sortedRows } = useClientSort(
    rows,
    {
      name: (f) => f.name?.toLowerCase(),
      type: (f) => f.figure_type,
      scale: (f) => f.scale,
      created_at: (f) => new Date(f.created_at).getTime(),
    },
    { key: "created_at", dir: "desc" },
  );
  // Paginate once; feed the active view the same slice so selection +
  // pagination stay coherent across the table↔grid flip. Reset to page 1 when
  // the search query or view changes.
  const { page, setPage, pageCount, pageRows } = useClientPagination(
    sortedRows,
    view === "grid" ? 24 : 20,
    `${q}|${view}`,
  );

  const onDelete = async () => {
    if (!deleting) return;
    await del.mutateAsync(deleting.id);
    setDeleting(null);
  };

  const columns = [
    {
      key: "cover",
      header: <span className="sr-only">{t("figure.spec.cover", { default: "Visuel" })}</span>,
      width: "64px",
      render: (f) => {
        const cover = resolveFigureCover(f);
        return (
          <span className="block w-10 h-12 bg-[var(--surface-sunken)] border border-[var(--border-subtle)] overflow-hidden">
            {cover ? (
              <img
                src={cover}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                className={`w-full h-full object-cover ${f.is_nsfw ? "nsfw-blur" : ""}`}
              />
            ) : null}
          </span>
        );
      },
    },
    {
      key: "name",
      header: t("admin.figures.col.name"),
      sortable: true,
      render: (f) => (
        <>
          <Link
            to={`/figures/${f.id}`}
            onClick={(e) => e.stopPropagation()}
            className="display text-[var(--on-surface)] hover:text-[var(--accent)] transition-colors leading-tight"
          >
            {f.name}
          </Link>
          <span className="flex items-center gap-2 mt-0.5">
            {f.manufacturer_name ? (
              <span className="text-[11px] text-[var(--on-surface-subtle)] truncate">
                {f.manufacturer_name}
              </span>
            ) : null}
            {f.version_name ? (
              <span className="text-[10px] text-[var(--accent)]/70">{f.version_name}</span>
            ) : null}
            {f.is_nsfw ? (
              <Badge tone="danger" className="!text-[9px] !px-1 !py-0">
                18
              </Badge>
            ) : null}
          </span>
        </>
      ),
    },
    {
      key: "type",
      header: t("admin.figures.col.type"),
      sortable: true,
      render: (f) => <TypeChip type={f.figure_type} t={t} />,
    },
    {
      key: "scale",
      header: t("admin.figures.col.scale"),
      sortable: true,
      render: (f) => (
        <span className="text-[var(--on-surface-muted)] text-xs">{f.scale ?? "—"}</span>
      ),
    },
    {
      key: "lot",
      header: t("admin.figures.col.lot", { default: "Lot" }),
      render: (f) => (
        <span className="font-mono text-[11px] tracking-wider text-[var(--accent)]/80">
          {String(f.id).slice(0, 8)}
        </span>
      ),
    },
    {
      key: "created_at",
      header: t("admin.figures.col.created"),
      sortable: true,
      render: (f) => (
        <span className="font-mono text-[10px] tracking-wider text-[var(--on-surface-subtle)]">
          {new Date(f.created_at).toLocaleDateString(appLocale())}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("admin.users.col.actions"),
      align: "right",
      render: (f) => (
        <div className="flex items-center gap-0.5 justify-end">
          <IconButton
            variant="ghost"
            icon={Pencil}
            label={t("admin.figures.action.edit")}
            onClick={() => setEditing(f)}
          />
          <IconButton
            variant="ghost"
            icon={Trash2}
            label={t("admin.figures.action.delete")}
            onClick={() => setDeleting(f)}
            className="hover:!text-[var(--danger)]"
          />
        </div>
      ),
    },
  ];

  return (
    <div className="relative">
      <AdminSectionHeader
        kanji="像"
        kicker={t("admin.kicker", { default: "ADMINISTRATION" })}
        label={t("admin.figures.kicker_label", { default: "CATALOGUE" })}
        title={t("admin.tab.figures")}
        subtitle={t("admin.figures.subtitle")}
      />

      {/* ─── Catalogue counts strip ─── */}
      <section
        className="reveal"
        style={{ "--i": 4 }}
        aria-label={t("admin.figures.metrics", { default: "Compteurs du catalogue" })}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label={t("collection.kpi.pieces")}
            value={counts.total}
            sub={t("admin.figures.metric.total_sub", { default: "fiches au catalogue" })}
            tone="gold"
          />
          <StatCard label={t("collection.kpi.types")} value={counts.types} />
          <StatCard label={t("collection.kpi.manufacturers")} value={counts.makers} />
          <StatCard
            label={t("admin.figures.metric.nsfw", { default: "Sensible" })}
            value={counts.nsfw}
            sub={t("admin.figures.metric.nsfw_sub", { default: "marquée(s) NSFW" })}
            tone={counts.nsfw > 0 ? "red" : undefined}
          />
        </div>
      </section>

      {/* ─── Filter + view toolbar ─── */}
      <div
        className="mt-10 mb-6 flex flex-col sm:flex-row sm:items-end gap-4 reveal"
        style={{ "--i": 5 }}
      >
        <label className="flex-1 min-w-0 block">
          <span className="micro flex items-center gap-2 mb-2">
            <span aria-hidden className="ja not-italic text-[var(--accent)] leading-none">
              探
            </span>
            {t("admin.figures.search")}
          </span>
          <div className="relative md:max-w-md">
            <Search
              size={15}
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--on-surface-subtle)] pointer-events-none"
            />
            <Input
              type="search"
              value={q}
              placeholder={t("admin.figures.search")}
              aria-label={t("admin.figures.search")}
              onChange={(e) => setQ(e.target.value)}
              className="!pl-9"
            />
          </div>
        </label>

        <SegmentedControl
          aria-label={t("admin.figures.view.label", { default: "Affichage" })}
          value={view}
          onChange={setView}
          className="self-start sm:self-end"
          options={[
            {
              value: "table",
              label: t("admin.figures.view.table", { default: "Table" }),
              icon: Table2,
            },
            {
              value: "grid",
              label: t("admin.figures.view.grid", { default: "Vitrine" }),
              icon: LayoutGrid,
            },
          ]}
        />
      </div>

      {/* The bulk bar is shared by both views — keyed off the same selection
          state, so multi-select survives a table↔grid flip. */}
      <BulkActionBar
        selectedIds={sel.selectedIds}
        onClear={sel.clear}
        onDelete={(idList) => bulkDel.mutateAsync(idList)}
        busy={bulkDel.isPending}
        confirmBody={t("admin.bulk.confirm.body.figures", { n: sel.selectedIds.length })}
      />

      <div className="reveal" style={{ "--i": 6 }}>
        {view === "table" ? (
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowId={(f) => f.id}
            sort={sort}
            onSort={onSort}
            selectable
            selectedIds={sel.selectedIds}
            onSelectionChange={selectionBridge(sel)}
            loading={figures.isLoading}
            empty={
              <EmptyState
                compact
                kanji="像"
                hue="var(--color-jade)"
                title={t("admin.empty.figures.title")}
                body={t("admin.empty.figures.body")}
              />
            }
          />
        ) : figures.isLoading ? (
          <p
            role="status"
            aria-live="polite"
            className="text-center text-[var(--on-surface-muted)] py-12"
          >
            …
          </p>
        ) : rows.length ? (
          <FiguresGrid rows={pageRows} sel={sel} t={t} onEdit={setEditing} onDelete={setDeleting} />
        ) : (
          <EmptyState
            compact
            kanji="像"
            hue="var(--color-jade)"
            title={t("admin.empty.figures.title")}
            body={t("admin.empty.figures.body")}
          />
        )}

        {pageCount > 1 ? (
          <div className="mt-6 flex justify-center">
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        ) : null}
      </div>

      {editing ? <FigureEditDialog figure={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={!!deleting}
        title={t("admin.figures.confirm_delete.title", { name: deleting?.name })}
        body={t("admin.figures.confirm_delete.body")}
        confirmLabel={t("admin.users.confirm_delete.confirm")}
        onConfirm={onDelete}
        onCancel={() => setDeleting(null)}
        busy={del.isPending}
        destructive
      />
    </div>
  );
}

// =============================================================================
// Type chip — the figure's type as a kanji-marked hairline plaque, echoing the
// FigureCard brass plaque in a table-friendly weight.
// =============================================================================

function TypeChip({ type, t }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="ja text-sm leading-none text-[var(--accent)]/70">
        {typeKanji(type)}
      </span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
        {t(`type.${type}`)}
      </span>
    </span>
  );
}

// =============================================================================
// Grid view — the FigureCard vitrine, with a selection checkbox + admin action
// rail overlaid per specimen. Selection feeds the same `sel` store, so the bulk
// bar works identically here.
// =============================================================================

function FiguresGrid({ rows, sel, t, onEdit, onDelete }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {rows.map((f) => {
        const selected = sel.isSelected(f.id);
        return (
          <li key={f.id} className="relative">
            <div
              className="relative block"
              style={{
                outline: selected ? "2px solid var(--accent)" : "none",
                outlineOffset: "0",
              }}
            >
              <FigureCard
                figureId={f.id}
                href={`/figures/${f.id}`}
                name={f.name}
                type={f.figure_type}
                manufacturer={f.manufacturer_name ?? null}
                imageUrl={resolveFigureCover(f)}
                scale={f.scale}
                versionName={f.version_name}
                blurImage={f.is_nsfw}
              />

              {/* Selection box — top-left, above the card chrome. */}
              <span className="absolute top-2 left-2 z-[6]">
                <SelectCheckbox
                  checked={selected}
                  onChange={() => sel.toggle(f.id)}
                  label={t("admin.bulk.select_row")}
                />
              </span>

              {/* Admin action rail — top-right, above the status corner. */}
              <span className="absolute top-2 right-2 z-[6] flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(f)}
                  title={t("admin.figures.action.edit")}
                  className="tap-target grid place-items-center w-8 h-8 text-xs bg-[color-mix(in_oklab,var(--surface-sunken)_88%,transparent)] border border-[var(--border-strong)] text-[var(--accent)] hover:text-[var(--on-surface)] hover:border-[var(--accent)] transition-colors"
                >
                  <Pencil size={14} />
                  <span className="sr-only">{t("admin.figures.action.edit")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  title={t("admin.figures.action.delete")}
                  className="tap-target grid place-items-center w-8 h-8 text-sm bg-[color-mix(in_oklab,var(--surface-sunken)_88%,transparent)] border border-[var(--border-strong)] text-[var(--on-surface-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)] transition-colors"
                >
                  <Trash2 size={14} />
                  <span className="sr-only">{t("admin.figures.action.delete")}</span>
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
