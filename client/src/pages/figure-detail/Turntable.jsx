import TurntableSection from "../../components/TurntableSection.jsx";

/**
 * #vue360 — the 360° turntable, pulled OUT of OwnerStack into its own
 * full-width band. TurntableSection handles both states internally (a ready
 * turntable/gsplat view, or the "+ capture a scan" entry when none exists yet).
 *
 * This wrapper presents it as a gallery turntable rather than a boxed widget:
 * the `.fig-band360` skin (in figure-detail.css) drops the heavy frame, hides
 * the redundant inner "Vue 360°" heading + image-count captions (the outer
 * #vue360 section head + the viewer's own scrub bar already convey those), and
 * lets the viewer breathe — centered and appreciably larger, using the
 * available width — while keeping the drag affordance and the
 * Remplacer / + Nouveau scan actions cleanly presented.
 */
export default function Turntable({ owned }) {
  return (
    <div className="fig-band360">
      <TurntableSection ownedId={owned.id} />
    </div>
  );
}
