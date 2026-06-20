// Client-side inventory / insurance export — a tabular snapshot of the owned
// collection (piece, manufacturer, condition, paid, estimated value) with
// per-currency + EUR totals. Generated in the browser so there's no server PDF
// dependency; jsPDF is dynamic-imported so it never weighs on the main bundle.
// Estimated value reuses the same cote chain as the rest of the app
// (`effectiveValue`: manual value → provider price → catalog MSRP).

import { effectiveValue, figurePaid, fmtMoney } from "./money.js";
import { appLocale } from "./locale.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Normalise owned items into export rows (paid + estimated value resolved). */
function rowsFrom(owned, t) {
  return (owned || []).map((o) => {
    const paid = figurePaid(o);
    const val = effectiveValue(o);
    return {
      name: o.figure_name || "",
      manufacturer: o.manufacturer_name || "",
      condition: t(`condition.${o.condition}`, { default: o.condition || "" }),
      paidAmount: paid?.amount ?? null,
      paidCurrency: paid?.currency ?? "",
      valueAmount: val?.amount ?? null,
      valueCurrency: val?.currency ?? "",
    };
  });
}

/** Sum a numeric field per currency → [{ currency, total }] sorted desc. */
function totalsByCurrency(rows, amountKey, currencyKey) {
  const m = new Map();
  for (const r of rows) {
    if (r[amountKey] == null) continue;
    const c = (r[currencyKey] || "").toUpperCase();
    if (!c) continue;
    m.set(c, (m.get(c) || 0) + Number(r[amountKey]));
  }
  return [...m.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);
}

/** Enriched CSV — one row per piece + value columns. Excel-friendly (BOM). */
export function exportInventoryCsv(owned, t) {
  const rows = rowsFrom(owned, t);
  const header = [
    t("export.inv.col.name", { default: "Pièce" }),
    t("export.inv.col.manufacturer", { default: "Fabricant" }),
    t("export.inv.col.condition", { default: "État" }),
    t("export.inv.col.paid", { default: "Payé" }),
    t("export.inv.col.currency", { default: "Devise" }),
    t("export.inv.col.value", { default: "Valeur estimée" }),
    t("export.inv.col.value_currency", { default: "Devise (valeur)" }),
  ];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.name,
        r.manufacturer,
        r.condition,
        r.paidAmount ?? "",
        r.paidCurrency,
        r.valueAmount ?? "",
        r.valueCurrency,
      ]
        .map(esc)
        .join(","),
    );
  }
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  downloadBlob(blob, `figurecollector-inventaire-${today()}.csv`);
}

/** Insurance-grade PDF — title, owner/date, per-currency + EUR value totals,
 *  then the full piece table. `stats` is optional (used for the EUR headline).
 *  With `returnDoc: true` the generated PDF is returned as an ArrayBuffer (used
 *  as the cover by the merged insurance dossier) instead of being downloaded. */
export async function exportInventoryPdf(owned, stats, t, { ownerName, returnDoc = false } = {}) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const rows = rowsFrom(owned, t);
  const valueTotals = totalsByCurrency(rows, "valueAmount", "valueCurrency");
  const loc = appLocale();

  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const GOLD = [176, 137, 74];
  const INK = [38, 34, 30];

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(...INK);
  doc.rect(0, 0, W, 64, "F");
  doc.setTextColor(214, 188, 140);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(t("export.inv.title", { default: "Inventaire de collection" }), 40, 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const sub = [
    ownerName,
    t("export.inv.generated", { date: new Date().toLocaleDateString(loc), default: `Généré le ${new Date().toLocaleDateString(loc)}` }),
    t("export.inv.pieces", { n: rows.length, default: `${rows.length} pièces` }),
  ]
    .filter(Boolean)
    .join("  ·  ");
  doc.text(sub, 40, 48);

  // ── Totals summary ─────────────────────────────────────────────────────────
  let y = 90;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(t("export.inv.total_value", { default: "Valeur estimée totale" }), 40, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  y += 16;
  // `fmtMoney` already prints the currency (e.g. "535,72 €" / "40 $US"), so we
  // don't append the ISO code — that produced the redundant "535,72 € EUR".
  const perCur = valueTotals
    .map((v) => fmtMoney(v.total, v.currency))
    .join("   ·   ");
  doc.text(perCur || "—", 40, y);
  // The EUR-normalised total only adds information when pieces span more than
  // one currency, or the single currency isn't EUR (then it's the EUR
  // equivalent). For an all-EUR collection it just repeats the line above, so
  // skip it. NB: no "≈" — jsPDF's Helvetica can't render U+2248 (showed as garbage).
  const showEur =
    stats?.eur?.value != null &&
    (valueTotals.length > 1 ||
      (valueTotals[0] && valueTotals[0].currency.toUpperCase() !== "EUR"));
  if (showEur) {
    y += 14;
    doc.setTextColor(...GOLD);
    doc.text(
      t("export.inv.eur_total", {
        amount: fmtMoney(stats.eur.value, "EUR"),
        date: stats.eur.fx_date || "",
        default: `Total en EUR : ${fmtMoney(stats.eur.value, "EUR")} (taux du ${stats.eur.fx_date || ""})`,
      }),
      40,
      y,
    );
    doc.setTextColor(...INK);
  }

  // ── Piece table ────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y + 18,
    head: [
      [
        t("export.inv.col.name", { default: "Pièce" }),
        t("export.inv.col.manufacturer", { default: "Fabricant" }),
        t("export.inv.col.condition", { default: "État" }),
        t("export.inv.col.paid", { default: "Payé" }),
        t("export.inv.col.value", { default: "Valeur est." }),
      ],
    ],
    body: rows.map((r) => [
      r.name,
      r.manufacturer,
      r.condition,
      r.paidAmount != null ? fmtMoney(r.paidAmount, r.paidCurrency) : "—",
      r.valueAmount != null ? fmtMoney(r.valueAmount, r.valueCurrency) : "—",
    ]),
    styles: { fontSize: 8.5, cellPadding: 4, textColor: INK, lineColor: [225, 218, 205] },
    headStyles: { fillColor: INK, textColor: [214, 188, 140], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 245, 238] },
    columnStyles: { 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });

  // ── Footer note on every page ───────────────────────────────────────────────
  const pages = doc.internal.getNumberOfPages();
  doc.setFontSize(7.5);
  doc.setTextColor(140, 134, 124);
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const H = doc.internal.pageSize.getHeight();
    doc.text(
      t("export.inv.footer", {
        default:
          "FigureCollector — valeurs estimées (cote/MSRP), fournies à titre indicatif.",
      }),
      40,
      H - 20,
    );
    doc.text(`${p} / ${pages}`, W - 40, H - 20, { align: "right" });
  }

  if (returnDoc) return doc.output("arraybuffer");
  doc.save(`figurecollector-inventaire-${today()}.pdf`);
}
