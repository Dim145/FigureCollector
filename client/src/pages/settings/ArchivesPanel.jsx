import { Download, FileSpreadsheet, FileJson } from "lucide-react";
import ImportPanel from "./ImportPanel.jsx";
import { useT } from "../../i18n/index.jsx";
import { useMyStats, useInsights } from "../../hooks/useStats.js";
import { useOwnedItems } from "../../hooks/useCollection.js";
import { useMe } from "../../hooks/useMe.js";
import { exportInventoryCsv, exportInventoryPdf } from "../../lib/inventoryExport.js";
import SettingsPanel from "./SettingsPanel.jsx";
import DossierExportButton from "../../components/DossierExportButton.jsx";

/**
 * 蔵 Archives — data export, relocated from the standalone /archives page and
 * kept here (the insurance dossier is *also* surfaced under /insights/dossier;
 * it stays here too, per brief).
 *
 *   - per-dataset cards (collection / wishlist / pré-commandes) with the live
 *     piece/wish/preorder counts (reused from `useMyStats` + `useInsights`) and
 *     CSV / JSON download links;
 *   - a full re-importable JSON backup;
 *   - the client-side inventory/insurance export (jsPDF / CSV) + the complete
 *     dossier (invoices merged server-side).
 *
 * Downloads are plain authenticated <a download> links — the session cookie
 * rides along and the server replies with Content-Disposition: attachment. The
 * shared `.dl-btn` / `.exp-*` utility classes carry the Direction-A styling.
 */
export default function ArchivesPanel({ registerRef }) {
  const t = useT();
  const stats = useMyStats();
  const insights = useInsights();
  const owned = useOwnedItems();
  const me = useMe();

  const pieces = stats.data?.total_pieces ?? 0;
  const wishes = insights.data?.wishlist_count ?? 0;
  const placedPreorders = stats.data?.preorders?.placed ?? 0;
  const hasOwned = !!owned.data?.length;

  return (
    <SettingsPanel
      id="archives"
      kanji="蔵"
      eyebrow={t("settings.nav.archives")}
      title={t("archives.title")}
      registerRef={registerRef}
    >
      <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
        {t("archives.subtitle")}
      </p>

      <div className="exp-grid mt-5">
        <ExportCard
          kanji="蒐"
          title={t("archives.collection")}
          count={pieces}
          countLabel={t("archives.count.pieces")}
          cols={t("archives.cols.collection")}
          base="collection"
          t={t}
        />
        <ExportCard
          kanji="望"
          title={t("archives.wishlist")}
          count={wishes}
          countLabel={t("archives.count.wishes")}
          cols={t("archives.cols.wishlist")}
          base="wishlist"
          t={t}
        />
        <ExportCard
          kanji="予"
          title={t("archives.preorders")}
          count={placedPreorders}
          countLabel={t("archives.count.preorders")}
          cols={t("archives.cols.preorders")}
          base="preorders"
          t={t}
        />
      </div>

      {/* Full re-importable JSON snapshot. */}
      <div className="exp-backup">
        <p>
          <b>{t("archives.backup.title")}</b> — {t("archives.backup.body")}
        </p>
        <a href="/api/me/export/backup.json" download className="dl-btn dl-btn--json">
          <Download size={14} aria-hidden /> {t("archives.backup.download")}
        </a>
      </div>

      {/* Inventory / insurance — generated client-side (jsPDF / CSV) from the
          owned collection: a dated per-piece table with paid + estimated value
          and per-currency / EUR totals. */}
      <div className="exp-backup">
        <p>
          <b>{t("export.inv.section", { default: "Inventaire / Assurance" })}</b> —{" "}
          {t("export.inv.desc", {
            default:
              "Un état daté de ta collection (pièce, état, valeur estimée), en PDF ou CSV — pratique pour l'assurance.",
          })}
        </p>
        <div className="exp-card-dls">
          <button
            type="button"
            disabled={!hasOwned}
            onClick={() =>
              exportInventoryPdf(owned.data, stats.data, t, {
                ownerName: me.data?.user?.display_name,
              })
            }
            className="dl-btn dl-btn--json disabled:opacity-40"
          >
            <Download size={14} aria-hidden /> PDF
          </button>
          <button
            type="button"
            disabled={!hasOwned}
            onClick={() => exportInventoryCsv(owned.data, t)}
            className="dl-btn dl-btn--csv disabled:opacity-40"
          >
            <Download size={14} aria-hidden /> CSV
          </button>
        </div>
        <DossierExportButton
          owned={owned.data}
          stats={stats.data}
          ownerName={me.data?.user?.display_name}
        />
      </div>
      <ImportPanel />
    </SettingsPanel>
  );
}

/**
 * One dataset's export card. Reuses the shared `.exp-card` / `.dl-btn` classes;
 * the per-dataset count comes from the orchestrator's cached stats.
 */
function ExportCard({ kanji, title, count, countLabel, cols, base, t }) {
  return (
    <article className="exp-card">
      <span className="exp-card-kanji" aria-hidden>
        {kanji}
      </span>
      <div className="exp-card-title">{title}</div>
      <div className="exp-card-count">
        <b>{count}</b>
        <span>{countLabel}</span>
      </div>
      <p className="exp-card-cols">
        <span className="exp-card-cols-label">{t("archives.columns")}</span>
        {cols}
      </p>
      <div className="exp-card-dls">
        <a href={`/api/me/export/${base}.csv`} download className="dl-btn dl-btn--csv">
          <FileSpreadsheet size={14} aria-hidden /> CSV
        </a>
        <a href={`/api/me/export/${base}.json`} download className="dl-btn dl-btn--json">
          <FileJson size={14} aria-hidden /> JSON
        </a>
      </div>
    </article>
  );
}
