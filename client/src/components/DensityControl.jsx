import { Grid3x3, Grip, LayoutGrid, Wand2 } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { DENSITIES } from "../hooks/useGridDensity.js";

const ICON = {
  auto: Wand2,
  comfort: LayoutGrid,
  dense: Grid3x3,
  contact: Grip,
};

/**
 * Plate-density switch: Auto · Confort · Dense · Planche-contact.
 *
 * `Auto` is a real option rather than an implicit default, so the shelf can
 * adapt as a collection grows without ever overriding a deliberate choice —
 * and the reader can always see which mode they're in.
 *
 * Icon **and** label (label hidden below `sm`, but always exposed to screen
 * readers): the modes differ by layout, which no icon conveys on its own.
 */
export default function DensityControl({ value, onChange, className = "" }) {
  const t = useT();
  return (
    <div
      className={`density-seg ${className}`}
      role="group"
      aria-label={t("plate.density.label", { default: "Densité d'affichage" })}
    >
      {DENSITIES.map((d) => {
        const Icon = ICON[d];
        const label = t(`plate.density.${d}`, { default: d });
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            className="density-seg-btn"
            aria-pressed={active}
            title={label}
            onClick={() => onChange(d)}
          >
            <Icon size={13} aria-hidden />
            <span className="hidden sm:inline">{label}</span>
            <span className="sr-only sm:hidden">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
