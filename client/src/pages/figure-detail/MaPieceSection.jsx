import { usePreorderForOwned } from "../../hooks/useCollection.js";
import Foldable from "../../components/Foldable.jsx";
import OwnedItemEditor from "../../components/OwnedItemEditor.jsx";
import CoverPicker from "../../components/CoverPicker.jsx";
import PhotoStrip from "../../components/PhotoStrip.jsx";
import DocumentsSection from "../../components/DocumentsSection.jsx";
import TrackingChip from "../../components/TrackingChip.jsx";

/**
 * #ma-piece — the owner layer of ⓪ La Fiche, visually SEPARATED from the
 * catalogue sections above (the Discogs model: the catalogue record, then a
 * distinct "this is YOUR copy" zone).
 *
 * Re-lays the former OwnerStack blocks (minus the 360° turntable, which is now
 * its own full-width #vue360 band — see Turntable.jsx):
 *   情 Mes informations  → OwnedItemEditor   (open)
 *   扉 Couverture        → CoverPicker        (collapsed)
 *   予 Suivi pré-commande → carrier-tracking chip (only when a tracking URL
 *                          exists — the horizontal timeline lives in #preco)
 *   影 Mes photos        → PhotoStrip
 *   証 Justificatifs     → DocumentsSection    (collapsed)
 *
 * Each sub-block stays foldable. The owner banner + the kanji watermark give
 * the zone its own identity (styled in figure-detail.css under `.fig-mapiece`).
 */
export default function MaPieceSection({ f, owned, nsfwPref, t }) {
  return (
    <div className="fig-mapiece-inner">
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

      {/* Carrier tracking — only when the linked preorder carries a tracking
       *  URL. The release-slip TIMELINE lives in #preco; this is just the live
       *  chip the owner pings. */}
      <OwnedTracking ownedId={owned.id} t={t} />

      <Foldable size="minor" kanji="影" label={t("figure.owner.tab.photos")}>
        <PhotoStrip
          ownedId={owned.id}
          figureName={f.name}
          uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
          blurImages={f.is_nsfw && nsfwPref === "blur"}
        />
      </Foldable>

      <Foldable size="minor" kanji="証" label={t("figure.owner.tab.documents")} defaultOpen={false}>
        <DocumentsSection ownedId={owned.id} />
      </Foldable>
    </div>
  );
}

/** Live carrier-tracking chip for an owned item's linked preorder (if any).
 *  Wraps itself in its own foldable so it doesn't clutter when absent. */
function OwnedTracking({ ownedId, t }) {
  const preorder = usePreorderForOwned(ownedId);
  const url = preorder.data?.tracking_url;
  if (!url) return null;
  return (
    <Foldable size="minor" kanji="予" label={t("figure.owner.tab.preorder")}>
      <p className="micro-tight mb-1.5">{t("preorders.tracking.carrier")}</p>
      <TrackingChip url={url} />
    </Foldable>
  );
}
