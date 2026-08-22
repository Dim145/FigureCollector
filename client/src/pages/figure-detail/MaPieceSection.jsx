import Foldable from "../../components/Foldable.jsx";
import OwnedItemEditor from "../../components/OwnedItemEditor.jsx";
import CoverPicker from "../../components/CoverPicker.jsx";
import PhotoStrip from "../../components/PhotoStrip.jsx";
import DocumentsSection from "../../components/DocumentsSection.jsx";
import ConditionReportSection from "../../components/ConditionReportSection.jsx";

/**
 * #ma-piece — the owner layer of ⓪ La Fiche, visually SEPARATED from the
 * catalogue sections above (the Discogs model: the catalogue record, then a
 * distinct "this is YOUR copy" zone).
 *
 * Keeps only genuine owner-copy data (the 360° turntable is its own full-width
 * #vue360 band; the pre-order history/tracking now lives in #preco):
 *   情 Mes informations  → OwnedItemEditor   (open)
 *   扉 Couverture        → CoverPicker        (collapsed)
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

      {/* 検 Arrival QC — sits next to the private documents on purpose: defect
          evidence is owner-only data, never catalogue material. */}
      <Foldable size="minor" kanji="検" label={t("figure.owner.tab.qc", { default: "Contrôle" })} defaultOpen={false}>
        <ConditionReportSection ownedId={owned.id} />
      </Foldable>
    </div>
  );
}
