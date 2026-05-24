/**
 * Direction B — auction-catalog card, modernised. Deep noir-soft surface
 * with a subtle linear sheen that runs top → centre so the card catches
 * the room's single light source rather than reading as a flat panel.
 * Border + drop shadow combine into a refined surface.
 */
export default function Card({ children, className = "", as: Tag = "div" }) {
  return (
    <Tag
      className={`relative bg-[var(--color-noir-soft)] border border-[var(--color-or)]/25 ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(155deg, oklch(0.78 0.10 80 / 0.04) 0%, transparent 35%)",
        boxShadow:
          "0 30px 80px -40px rgba(0,0,0,0.8), 0 1px 0 oklch(0.78 0.10 80 / 0.08) inset, 0 0 0 1px transparent",
      }}
    >
      {children}
    </Tag>
  );
}
