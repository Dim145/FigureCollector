/**
 * Direction B — auction-catalog card. Deep noir-soft surface, thin gold border,
 * dramatic drop shadow. The frame visibly catches the room's single light source.
 */
export default function Card({ children, className = "", as: Tag = "div" }) {
  return (
    <Tag
      className={`relative bg-[var(--color-noir-soft)] border border-[var(--color-or)]/25 ${className}`}
      style={{
        boxShadow:
          "0 30px 80px -40px rgba(0,0,0,0.8), inset 0 1px 0 oklch(0.78 0.10 80 / 0.06)",
      }}
    >
      {children}
    </Tag>
  );
}
