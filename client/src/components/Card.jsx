/**
 * Surface container, on semantic tokens. Keeps Direction A's editorial sheen
 * (a faint gold linear wash) + a tokenised elevation ramp. Stays sharp-cornered
 * by default to match the identity (buttons/chips are the round things).
 *
 * Backward-compatible: <Card className as>{children}</Card> works as before.
 * New props: elevation 0-4, interactive (adds card-lift + pointer), hue (sets
 * the per-type --hue used by .fc-card-style spotlights).
 */
const ELEVATIONS = {
  0: "none",
  1: "var(--elevation-1)",
  2: "var(--elevation-2)",
  3: "var(--elevation-3)",
  4: "var(--elevation-4)",
};

export default function Card({
  children,
  className = "",
  as: Tag = "div",
  elevation = 2,
  interactive = false,
  hue,
  style,
  ...props
}) {
  return (
    <Tag
      className={`relative bg-[var(--surface)] border border-[var(--border)] ${
        interactive ? "card-lift cursor-pointer" : ""
      } ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(155deg, color-mix(in oklab, var(--accent) 4%, transparent) 0%, transparent 35%)",
        boxShadow: ELEVATIONS[elevation] ?? ELEVATIONS[2],
        ...(hue ? { "--hue": hue } : null),
        ...style,
      }}
      {...props}
    >
      {children}
    </Tag>
  );
}
