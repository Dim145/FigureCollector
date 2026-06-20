import { usePreorderForOwned } from "../../hooks/useCollection.js";
import { useScans } from "../../hooks/useScans.js";
import AccentTitle from "../../components/AccentTitle.jsx";
import Foldable from "../../components/Foldable.jsx";
import OwnedItemEditor from "../../components/OwnedItemEditor.jsx";
import CoverPicker from "../../components/CoverPicker.jsx";
import PreorderHistory from "../../components/PreorderHistory.jsx";
import PhotoStrip from "../../components/PhotoStrip.jsx";
import DocumentsSection from "../../components/DocumentsSection.jsx";
import TurntableSection from "../../components/TurntableSection.jsx";
import TrackingChip from "../../components/TrackingChip.jsx";

/**
 * Owner-only vertical stack — a sequence of standardised <Foldable size="minor">
 * blocks (no tabs, mobile-friendly long scroll). Each renders a shared,
 * compose-only domain surface:
 *
 *   情 Mes informations  → OwnedItemEditor   (open by default)
 *   扉 Couverture        → CoverPicker        (collapsed)
 *   予 Pré-commande      → PreorderHistory     (only when a release date exists)
 *   影 Mes photos        → PhotoStrip
 *   証 Justificatifs     → DocumentsSection    (collapsed)
 *   巡 Vue 360°          → TurntableSection    (open when a scan already exists)
 *
 * Carries `id="owner-stack"` so the hero's "Éditer ma pièce" CTA can scroll
 * here. The heavy interactive surfaces (PhotoEditor, TurntableWizard) open
 * themselves fullscreen via `fixed inset-0`.
 */
export default function OwnerStack({ f, owned, nsfwPref, t }) {
  // Default-expand the 360° block when a turntable/gsplat view already exists
  // (rather than the empty "+ create a scan" state). Shares useScans' cache
  // with TurntableSection — no extra request.
  const scans = useScans(owned.id);
  const hasScanView = (scans.data ?? []).some(
    (s) => s.state === "ready" && (s.kind === "turntable" || (s.kind === "gsplat" && s.result_key)),
  );

  return (
    <section id="owner-stack" className="max-w-7xl mx-auto px-6 mt-16 fig-owner-shell scroll-mt-24">
      <header className="text-center mb-2">
        <p className="micro inline-flex items-center gap-2.5">
          <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
          {t("figure.owner.eyebrow")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            私
          </span>
        </p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-1.5">
          <AccentTitle text={t("figure.owner.title")} />
        </h2>
        <div className="gold-rule w-20 mx-auto mt-4" />
      </header>

      <Foldable size="minor" kanji="情" label={t("figure.owner.tab.info")}>
        <OwnedItemEditor
          owned={owned}
          catalogMsrp={f.msrp_amount}
          catalogCurrency={f.msrp_currency}
        />
      </Foldable>

      <Foldable size="minor" kanji="扉" label={t("figure.owner.tab.cover")} defaultOpen={false}>
        <CoverPicker owned={owned} />
      </Foldable>

      {/* Pre-order block: only when the figure has a release date (the inner
       *  component renders nothing when no linked preorder exists). */}
      {f.release_date ? (
        <Foldable size="minor" kanji="予" label={t("figure.owner.tab.preorder")}>
          <PreorderHistory ownedId={owned.id} />
          <OwnedTracking ownedId={owned.id} t={t} />
        </Foldable>
      ) : null}

      {/* Photo gallery — inline. The internal photo *editor* (PhotoEditor) and
       *  the lightbox render as their own fullscreen overlays when triggered. */}
      <Foldable size="minor" kanji="影" label={t("figure.owner.tab.photos")}>
        <PhotoStrip
          ownedId={owned.id}
          figureName={f.name}
          uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
          blurImages={f.is_nsfw && nsfwPref === "blur"}
        />
      </Foldable>

      {/* Proof-of-purchase documents — receipts / invoices / customs slips,
       *  private to the owner. */}
      <Foldable size="minor" kanji="証" label={t("figure.owner.tab.documents")} defaultOpen={false}>
        <DocumentsSection ownedId={owned.id} />
      </Foldable>

      {/* 360° viewer — inline. The capture wizard (TurntableWizard) is the only
       *  heavy interactive surface; it opens itself fullscreen. */}
      <Foldable
        size="minor"
        kanji="巡"
        label={t("figure.owner.tab.scan")}
        defaultOpen={hasScanView}
      >
        <TurntableSection ownedId={owned.id} />
      </Foldable>
    </section>
  );
}

/** Live carrier-tracking chip for an owned item's linked preorder (if any). */
function OwnedTracking({ ownedId, t }) {
  const preorder = usePreorderForOwned(ownedId);
  const url = preorder.data?.tracking_url;
  if (!url) return null;
  return (
    <div className="mt-4">
      <p className="micro-tight mb-1.5">{t("preorders.tracking.carrier")}</p>
      <TrackingChip url={url} />
    </div>
  );
}
