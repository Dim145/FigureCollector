import TurntableSection from "../../components/TurntableSection.jsx";

/**
 * #vue360 — the 360° turntable, pulled OUT of OwnerStack into its own
 * full-width band. TurntableSection handles both states internally: a ready
 * turntable/gsplat view, or the "+ capture a scan" entry when none exists yet,
 * so this is a thin full-width wrapper around the shared owner-only component.
 */
export default function Turntable({ owned }) {
  return (
    <div className="fig-band360">
      <TurntableSection ownedId={owned.id} />
    </div>
  );
}
