import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import FigureLookupModal from "./figure-form/FigureLookupModal.jsx";

/**
 * The external-lookup entry point for the figure form. Renders a prominent
 * "Pré-remplir depuis une source" control; clicking it opens
 * <FigureLookupModal> — a tabbed shell (Recherche · Lien · Code-barres ·
 * AniList) that searches orzgk + the proxy boutiques, resolves pasted product
 * links, scans barcodes, and (on pick) hands a normalised prefill payload back
 * to the form via `onPick`.
 *
 * Public API is unchanged from the old inline panel so `FigureForm` keeps
 * working: { initial, onPick }. All the wizardry now lives in
 * `components/figure-form/` (FigureLookupModal + LookupSearch +
 * LookupDetailModal + MfcPasteImport + LookupAniList + lookupSources).
 *
 * @param {object} props
 * @param {string} [props.initial=""]  seed query (the figure name typed so far)
 * @param {(pick: object) => void} props.onPick
 *   Receives a payload the form spreads into its state, e.g.
 *     { name, manufacturer_name, series_name, character_name, figure_type,
 *       scale, official_image_url, version_name, msrp_amount, msrp_currency,
 *       release_date, is_nsfw, description, jan, series_meta, source_url }
 */
export default function FigureLookup({ initial = "", onPick }) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-2 px-3 py-2 min-h-[44px] border border-[var(--border-strong)] bg-[var(--accent)]/5 text-[var(--color-or-pale)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors text-[11px] uppercase tracking-[0.18em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <Sparkles size={14} aria-hidden />
        {t("lookup.figure.open")}
      </button>

      <FigureLookupModal
        open={open}
        onClose={() => setOpen(false)}
        onPick={onPick}
        initial={initial}
        t={t}
      />
    </>
  );
}
