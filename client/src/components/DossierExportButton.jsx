import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { exportInsuranceDossier } from "../lib/insuranceDossier.js";

// The "complete" insurance export: the inventory cover merged server-side with
// each figurine's uploaded invoices into one PDF. It's slower than the plain
// PDF/CSV (a round-trip + a merge), so it carries its own busy + error state.
export default function DossierExportButton({ owned, stats, ownerName }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const hasOwned = !!owned?.length;

  async function run() {
    if (busy) return;
    setErr(false);
    setBusy(true);
    try {
      await exportInsuranceDossier(owned, stats, t, { ownerName });
    } catch (e) {
      console.error("insurance dossier export failed", e);
      setErr(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dossier-export">
      <button
        type="button"
        disabled={!hasOwned || busy}
        onClick={run}
        aria-busy={busy}
        className="dl-btn dl-btn--dossier disabled:opacity-40"
      >
        {busy ? (
          <>
            <span className="dossier-spin" aria-hidden="true" />
            {t("export.dossier.building", { default: "Génération du dossier…" })}
          </>
        ) : (
          <>↓ {t("export.dossier.button", { default: "Dossier complet (avec justificatifs)" })}</>
        )}
      </button>
      <p className="dossier-note micro">
        {t("export.dossier.note", {
          default: "Fusionne les factures de chaque figurine dans un seul PDF (plus long à générer).",
        })}
      </p>
      {err && (
        <p className="dossier-err" role="alert">
          {t("export.dossier.error", { default: "Échec de la génération du dossier. Réessaie." })}
        </p>
      )}
    </div>
  );
}
