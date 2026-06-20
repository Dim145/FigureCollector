import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../i18n/index.jsx";
import { Section } from "../../components/layout/index.js";
import { DataTable } from "../../components/ui/index.js";
import Money from "../../components/Money.jsx";
import { StepSparkline, seriesDelta } from "../../components/PriceHistory.jsx";
import { typeHue, typeKanji } from "../../lib/typeHue.js";
import CoteValueCell from "./CoteValueCell.jsx";
import { coteComparator } from "./coteShared.jsx";

/**
 * « Pièces par valeur » — the per-piece ranking. Owns only its own sort state;
 * value resolution + the inline-edit mutation come from CotePage.
 *
 *  - ≥ md : the shared sortable DataTable (pièce · cote · achat · Δ · %). The
 *    cote cell is inline-editable; a trend sparkline opens the relevés dialog.
 *    The table scrolls inside its own well — the page never side-scrolls.
 *  - < md : the same rows as tappable cards, value-ranked, each with the cote
 *    editor inline. No horizontal table on small screens.
 *
 * Sorting defaults to value desc (the headline order). Unpriced / unpaid rows
 * sink to the bottom of every sort.
 */
export default function CoteRanking({
  rows,
  historyByFigure,
  editId,
  draft,
  onDraft,
  onStartEdit,
  onSave,
  onCancel,
  onResetMsrp,
  saving,
  onOpenHistory,
}) {
  const t = useT();
  const [sort, setSort] = useState({ key: "value", dir: "desc" });

  const sorted = useMemo(() => [...rows].sort(coteComparator(sort)), [rows, sort]);

  const cellProps = (row) => ({
    t,
    row,
    editing: editId === row.o.id,
    draft,
    onDraft,
    onStartEdit,
    onSave,
    onCancel,
    onResetMsrp,
    saving,
  });

  // ── Desktop columns ────────────────────────────────────────────────────────
  const columns = [
    {
      key: "name",
      header: t("cote.col.piece", { default: "Pièce" }),
      sortable: true,
      render: (row) => <PieceCell row={row} t={t} />,
    },
    {
      key: "trend",
      header: t("cote.col.trend", { default: "Marché" }),
      align: "center",
      render: (row) => {
        const series = historyByFigure.get(row.o.figure_id) ?? [];
        if (series.length < 2) return <span className="text-[var(--on-surface-subtle)]">—</span>;
        const sd = seriesDelta(series);
        return (
          <button
            type="button"
            onClick={() => onOpenHistory(row.o)}
            title={t("cote.history.evolution", { default: "Évolution" })}
            className="tap-target inline-flex flex-col items-center gap-0.5"
          >
            <StepSparkline points={series} />
            {sd ? (
              <span
                className="font-mono text-[9.5px]"
                style={{ color: sd.abs >= 0 ? "var(--success)" : "var(--danger)" }}
              >
                {sd.abs >= 0 ? "▲ +" : "▼ −"}
                {Math.abs(sd.pct).toFixed(1)} %
              </span>
            ) : null}
          </button>
        );
      },
    },
    {
      key: "paid",
      header: t("cote.col.paid", { default: "Achat" }),
      sortable: true,
      align: "right",
      render: (row) =>
        row.paid ? (
          <span className="font-mono tabular-nums text-[var(--on-surface-muted)]">
            <Money amount={row.paid.amount} currency={row.paid.currency} />
          </span>
        ) : (
          <span className="text-[var(--on-surface-subtle)]">—</span>
        ),
    },
    {
      key: "value",
      header: t("cote.col.value", { default: "Cote" }),
      sortable: true,
      align: "right",
      render: (row) => <CoteValueCell {...cellProps(row)} align="right" />,
    },
    {
      key: "deltaPct",
      header: t("cote.col.delta", { default: "+/−" }),
      sortable: true,
      align: "right",
      render: (row) =>
        row.deltaPct != null ? (
          <span
            className="font-mono tabular-nums"
            style={{ color: row.deltaPct >= 0 ? "var(--success)" : "var(--danger)" }}
          >
            {row.deltaPct >= 0 ? "+" : ""}
            {row.deltaPct.toFixed(1)} %
          </span>
        ) : (
          <span className="text-[var(--on-surface-subtle)]">—</span>
        ),
    },
  ];

  return (
    <Section
      kicker={t("cote.ranked_kicker", { default: "INVENTAIRE · 価 · CLASSEMENT" })}
      title={t("cote.ranked_title", { default: "Pièces par valeur" })}
      divider
    >
      <p className="-mt-2 mb-4 text-[12px] text-[var(--on-surface-muted)]">
        {t("cote.edit_hint", { default: "Clique une valeur pour l'estimer." })}
      </p>

      {/* Desktop: sortable table (scrolls in its own well). */}
      <div className="hidden md:block border border-[var(--border)] bg-[var(--surface)]">
        <DataTable
          columns={columns}
          rows={sorted}
          getRowId={(r) => r.o.id}
          sort={sort}
          onSort={setSort}
        />
      </div>

      {/* Mobile: value-ranked cards (no horizontal scroll). */}
      <ul className="md:hidden space-y-2">
        {sorted.map((row) => (
          <li key={row.o.id}>
            <MobileRow
              row={row}
              t={t}
              series={historyByFigure.get(row.o.figure_id) ?? []}
              cellProps={cellProps(row)}
              onOpenHistory={onOpenHistory}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Piece identity cell: kanji-faced type tile + name + manufacturer. */
function PieceCell({ row, t }) {
  const { o } = row;
  const hue = typeHue(o.figure_type);
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span
        aria-hidden
        className="ja grid place-items-center w-9 h-11 shrink-0 text-xl border"
        style={{
          borderColor: `color-mix(in oklab, ${hue} 30%, transparent)`,
          color: `color-mix(in oklab, ${hue} 60%, transparent)`,
          borderRadius: "var(--radius-sm)",
        }}
      >
        {typeKanji(o.figure_type)}
      </span>
      <div className="min-w-0">
        <Link
          to={`/figures/${o.figure_id}`}
          className="block font-medium text-[var(--on-surface)] hover:text-[var(--accent)] transition-colors line-clamp-1"
        >
          {o.figure_name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--on-surface-muted)]">
          <span>{t(`type.${o.figure_type}`, { default: o.figure_type })}</span>
          {o.manufacturer_name ? (
            <span className="font-mono truncate">· {o.manufacturer_name}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One ranked piece as a card (mobile). Cote editor inline; trend opens dialog. */
function MobileRow({ row, t, series, cellProps, onOpenHistory }) {
  const { o, paid } = row;
  const sd = seriesDelta(series);
  return (
    <div
      id={`figure-${o.figure_id}`}
      className="border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <PieceCell row={row} t={t} />
        {series.length >= 2 ? (
          <button
            type="button"
            onClick={() => onOpenHistory(o)}
            title={t("cote.history.evolution", { default: "Évolution" })}
            className="tap-target flex flex-col items-end gap-0.5 shrink-0"
          >
            <StepSparkline points={series} />
            {sd ? (
              <span
                className="font-mono text-[9px]"
                style={{ color: sd.abs >= 0 ? "var(--success)" : "var(--danger)" }}
              >
                {sd.abs >= 0 ? "▲ +" : "▼ −"}
                {Math.abs(sd.pct).toFixed(1)} %
              </span>
            ) : null}
          </button>
        ) : null}
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex items-end justify-between gap-3">
        <div className="text-[11px] font-mono text-[var(--on-surface-muted)]">
          {paid ? (
            <>
              <span className="block text-[10px] uppercase tracking-[0.12em] text-[var(--on-surface-subtle)]">
                {t("cote.paid_abbr", { default: "payé" })}
              </span>
              <Money amount={paid.amount} currency={paid.currency} />
            </>
          ) : null}
        </div>
        <CoteValueCell {...cellProps} align="right" />
      </div>
    </div>
  );
}
