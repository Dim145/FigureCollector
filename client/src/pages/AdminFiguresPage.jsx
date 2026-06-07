import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useAdminFigures,
  useBulkDeleteFigures,
  useDeleteFigure,
} from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import { resolveFigureCover } from "../lib/coverUrl.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import Card from "../components/Card.jsx";
import EmptyState from "../components/EmptyState.jsx";
import FigureCard from "../components/FigureCard.jsx";
import StatCard from "../components/StatCard.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";

/**
 * /admin/figures — moderation of the whole catalogue, redrawn to Direction A
 * ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * sub-nav already sit above this page. This view is therefore an editorial
 * *section* of the admin surface (kicker · 像 · CATALOGUE → AccentTitle h2 →
 * gold-rule over a faint kanji-mark) rather than a second page header — the
 * same shape as AdminOverviewPage.
 *
 * Layout, top-to-bottom:
 *   - the editorial section header;
 *   - a StatCard strip of figurine counts derived *purely* from the rows the
 *     `useAdminFigures` query already returned (no extra fetch) — pièces, types
 *     distincts, fabricants, NSFW; gold marks the headline catalogue count;
 *   - a filter / view bar (the search box + a hairline table↔grid toggle);
 *   - the catalogue itself, either a hairline A table or a FigureCard grid.
 *     Both share the SAME row-selection + bulk-delete machinery, so the floating
 *     BulkActionBar works identically in either view; mono lot ids, kanji-marked
 *     type chips, hanko-red edit / laque destructive affordances.
 *
 * Every data hook, mutation, the multi-select, the bulk-delete, the search
 * filter, the edit dialog and the destructive guard are untouched from the
 * prior layout — only the JSX is restyled / restructured. GPU-light throughout:
 * flat fills + hairlines, the shared `.reveal` stagger, no meshes / blur /
 * continuous animation.
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

  const rows = figures.data ?? [];
  const ids = useMemo(() => rows.map((f) => f.id), [rows]);
  const sel = useRowSelection(ids);

  // Glanceable catalogue counts — derived from the rows already in hand so the
  // strip costs nothing extra. Counts only, so tones stay quiet; gold marks the
  // headline catalogue figure, hanko-red flags the NSFW pieces that moderation
  // most cares about, per the playbook.
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

  const onDelete = async () => {
    if (!deleting) return;
    await del.mutateAsync(deleting.id);
    setDeleting(null);
  };

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-10">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] -top-24 -right-6 hidden md:block select-none"
        >
          像
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.kicker", { default: "ADMINISTRATION" })}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            像
          </span>
          {t("admin.figures.kicker_label", { default: "CATALOGUE" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.tab.figures")} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="display-italic text-[var(--color-or)] text-base md:text-lg mt-4 max-w-xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.figures.subtitle")}
        </p>
      </header>

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
            <span aria-hidden className="ja not-italic text-[var(--color-or)] leading-none">
              探
            </span>
            {t("admin.figures.search")}
          </span>
          <input
            type="search"
            value={q}
            placeholder={t("admin.figures.search")}
            aria-label={t("admin.figures.search")}
            onChange={(e) => setQ(e.target.value)}
            className="w-full md:max-w-md bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-2.5 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
          />
        </label>

        <ViewToggle view={view} setView={setView} t={t} />
      </div>

      {figures.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : rows.length ? (
        <div className="reveal" style={{ "--i": 6 }}>
          {/* The bulk bar is shared by both views — it keys off the same
              selection state, so multi-select survives a table↔grid flip. */}
          <BulkActionBar
            selectedIds={sel.selectedIds}
            onClear={sel.clear}
            onDelete={(idList) => bulkDel.mutateAsync(idList)}
            busy={bulkDel.isPending}
            confirmBody={t("admin.bulk.confirm.body.figures", {
              n: sel.selectedIds.length,
            })}
          />

          {view === "table" ? (
            <FiguresTable
              rows={rows}
              sel={sel}
              t={t}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ) : (
            <FiguresGrid
              rows={rows}
              sel={sel}
              t={t}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          )}
        </div>
      ) : (
        <EmptyState
          compact
          kanji="像"
          hue="var(--color-jade)"
          title={t("admin.empty.figures.title")}
          body={t("admin.empty.figures.body")}
        />
      )}

      {editing ? (
        <FigureEditDialog
          figure={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        createPortal(
          <div
            role="dialog"
            aria-modal
            aria-labelledby="figures-delete-dialog-title"
            onClick={() => setDeleting(null)}
            className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
          >
          {/* `Card` doesn't forward arbitrary DOM props, so the
              stop-propagation that keeps an inside click from closing the
              dialog lives on this wrapper (load-bearing — preserves the prior
              behaviour). Card supplies only the Direction-A surface. */}
          <div onClick={(e) => e.stopPropagation()} className="w-[92vw] max-w-md">
            <Card className="relative overflow-hidden p-8 !border-[var(--color-or)]/40">
              <span
                aria-hidden
                className="kanji-mark text-[10rem] -top-10 -right-4 select-none"
              >
                削
              </span>
              <div className="relative">
                <p className="micro flex items-center gap-2">
                  <span
                    aria-hidden
                    className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
                  />
                  {t("admin.figures.action.delete")}
                </p>
                <h2
                  id="figures-delete-dialog-title"
                  className="display text-2xl text-[var(--color-ivoire)] mt-2 leading-tight"
                >
                  {t("admin.figures.confirm_delete.title", { name: deleting.name })}
                </h2>
                <div className="gold-rule w-16 mt-4" />
                <p className="mt-4 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
                  {t("admin.figures.confirm_delete.body")}
                </p>
                <div className="flex items-center gap-3 justify-end mt-7">
                  <Button variant="ghost" onClick={() => setDeleting(null)}>
                    {t("editor.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    onClick={onDelete}
                    loading={del.isPending}
                    className="!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]"
                  >
                    {t("admin.users.confirm_delete.confirm")}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
          </div>,
          document.body,
        )
      ) : null}
    </div>
  );
}

// =============================================================================
// View toggle — a hairline segmented control flipping the catalogue between the
// dense moderation table and the visual FigureCard grid. Presentation only:
// real <button>s with aria-pressed, the active one in hanko-red.
// =============================================================================

function ViewToggle({ view, setView, t }) {
  const opts = [
    { id: "table", kanji: "表", label: t("admin.figures.view.table", { default: "Table" }) },
    { id: "grid", kanji: "陳", label: t("admin.figures.view.grid", { default: "Vitrine" }) },
  ];
  return (
    <div
      role="group"
      aria-label={t("admin.figures.view.label", { default: "Affichage" })}
      className="flex shrink-0 border border-[var(--color-or)]/25 bg-[var(--color-noir)]/40 self-start sm:self-end"
    >
      {opts.map((o) => {
        const isActive = view === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setView(o.id)}
            aria-pressed={isActive}
            className="tap-target flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-[0.18em] transition-colors"
            style={{
              color: isActive ? "var(--color-ivoire)" : "var(--color-ivoire-soft)",
              background: isActive
                ? "color-mix(in oklab, var(--color-laque) 14%, transparent)"
                : "transparent",
            }}
          >
            <span
              aria-hidden
              className="ja text-sm leading-none"
              style={{
                color: isActive ? "var(--color-laque-bright)" : "var(--color-or)",
                opacity: isActive ? 1 : 0.6,
              }}
            >
              {o.kanji}
            </span>
            {o.label}
          </button>
        );
      })}
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
      <span
        aria-hidden
        className="ja text-sm leading-none text-[var(--color-or)]/70"
      >
        {typeKanji(type)}
      </span>
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]">
        {t(`type.${type}`)}
      </span>
    </span>
  );
}

// =============================================================================
// Table view — the hairline A table, restyled. Same selection + actions.
// =============================================================================

function FiguresTable({ rows, sel, t, onEdit, onDelete }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] border-b border-[var(--color-or)]/15">
            <th className="px-4 py-3 font-normal w-[34px]">
              <SelectCheckbox
                checked={sel.allSelected}
                indeterminate={sel.someSelected && !sel.allSelected}
                onChange={sel.toggleAll}
                label={t("admin.bulk.select_all")}
              />
            </th>
            <th className="px-4 py-3 font-normal w-[64px]">
              <span className="sr-only">{t("figure.spec.cover", { default: "Visuel" })}</span>
            </th>
            <th className="px-4 py-3 font-normal">{t("admin.figures.col.name")}</th>
            <th className="px-4 py-3 font-normal">{t("admin.figures.col.type")}</th>
            <th className="px-4 py-3 font-normal">{t("admin.figures.col.scale")}</th>
            <th className="px-4 py-3 font-normal">
              {t("admin.figures.col.lot", { default: "Lot" })}
            </th>
            <th className="px-4 py-3 font-normal">{t("admin.figures.col.created")}</th>
            <th className="px-4 py-3 font-normal text-right">
              {t("admin.users.col.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const cover = resolveFigureCover(f);
            return (
              <tr
                key={f.id}
                className={`border-b border-[var(--color-or)]/10 hover:bg-[var(--color-or)]/5 transition-colors ${
                  sel.isSelected(f.id) ? "adm-row-selected" : ""
                }`}
              >
                <td className="px-4 py-3 align-middle">
                  <SelectCheckbox
                    checked={sel.isSelected(f.id)}
                    onChange={() => sel.toggle(f.id)}
                    label={t("admin.bulk.select_row")}
                  />
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className="block w-10 h-12 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden">
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
                </td>
                <td className="px-4 py-3 align-middle">
                  <Link
                    to={`/figures/${f.id}`}
                    className="display text-[var(--color-ivoire)] hover:text-[var(--color-or)] transition-colors leading-tight"
                  >
                    {f.name}
                  </Link>
                  <span className="flex items-center gap-2 mt-0.5">
                    {f.manufacturer_name ? (
                      <span className="text-[11px] text-[var(--color-ivoire-soft)]/70 truncate">
                        {f.manufacturer_name}
                      </span>
                    ) : null}
                    {f.version_name ? (
                      <span className="text-[10px] text-[var(--color-or-pale)]/70">
                        {f.version_name}
                      </span>
                    ) : null}
                    {f.is_nsfw ? (
                      <span
                        className="text-[9px] uppercase tracking-[0.18em] text-[var(--color-laque-bright)] border border-[var(--color-laque-bright)]/40 px-1 leading-tight"
                        title={t("admin.figures.metric.nsfw", { default: "Sensible" })}
                      >
                        18
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <TypeChip type={f.figure_type} t={t} />
                </td>
                <td className="px-4 py-3 align-middle text-[var(--color-ivoire-soft)] text-xs">
                  {f.scale ?? "—"}
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className="font-mono text-[11px] tracking-wider text-[var(--color-or-pale)]/80">
                    {String(f.id).slice(0, 8)}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle">
                  <span className="font-mono text-[10px] tracking-wider text-[var(--color-ivoire-soft)]/70">
                    {new Date(f.created_at).toLocaleDateString()}
                  </span>
                </td>
                <td className="px-4 py-3 align-middle text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => onEdit(f)}
                      title={t("admin.figures.action.edit")}
                      className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xs px-2 py-1 transition-colors"
                    >
                      ✎<span className="sr-only">{t("admin.figures.action.edit")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(f)}
                      title={t("admin.figures.action.delete")}
                      className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-xs px-2 py-1 transition-colors"
                    >
                      ×<span className="sr-only">{t("admin.figures.action.delete")}</span>
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// =============================================================================
// Grid view — the FigureCard vitrine, with a selection checkbox + admin action
// rail overlaid per specimen. Selection feeds the same `sel` store, so the
// bulk bar works identically here.
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
                outline: selected ? "2px solid var(--color-or)" : "none",
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
                  className="tap-target grid place-items-center w-8 h-8 text-xs bg-[color-mix(in_oklab,var(--color-noir-deep)_78%,transparent)] border border-[var(--color-or)]/40 text-[var(--color-or-pale)] hover:text-[var(--color-or)] hover:border-[var(--color-or)] transition-colors"
                >
                  ✎<span className="sr-only">{t("admin.figures.action.edit")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(f)}
                  title={t("admin.figures.action.delete")}
                  className="tap-target grid place-items-center w-8 h-8 text-sm bg-[color-mix(in_oklab,var(--color-noir-deep)_78%,transparent)] border border-[var(--color-or)]/40 text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)] transition-colors"
                >
                  ×<span className="sr-only">{t("admin.figures.action.delete")}</span>
                </button>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Local kanji fallback for the table type chip — mirrors FigureCard's mapping
// so the table reads in the same visual language without re-fetching the
// admin-curated type registry for a tiny inline glyph.
function typeKanji(type) {
  switch (type) {
    case "nendoroid":  return "童";
    case "scale":      return "像";
    case "figma":      return "動";
    case "prize":      return "賞";
    case "trading":    return "交";
    case "statue":     return "彫";
    case "plamo":      return "組";
    case "bishoujo":   return "美";
    case "dakimakura": return "枕";
    default:           return "玩";
  }
}
