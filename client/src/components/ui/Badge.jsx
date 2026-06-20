/**
 * Small status / count label. `tone` maps to a semantic colour; `solid` fills
 * it. Default is a quiet tinted outline. Decorative — pair with text when it
 * conveys meaning.
 */
const TONES = {
  neutral: "var(--on-surface-muted)",
  gold: "var(--accent)",
  danger: "var(--danger)",
  success: "var(--success)",
  warning: "var(--warning)",
  info: "var(--info)",
};

export default function Badge({
  tone = "neutral",
  solid = false,
  children,
  className = "",
  style,
  ...props
}) {
  const color = TONES[tone] ?? TONES.neutral;
  const tinted = tone === "neutral" ? "var(--on-surface)" : color;
  const solidText =
    tone === "gold" || tone === "warning" ? "var(--color-noir)" : "var(--color-ivoire)";
  const themed = solid
    ? { background: color, color: solidText, borderColor: color }
    : {
        color,
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${tinted} 8%, transparent)`,
      };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium tracking-wide border ${className}`}
      style={{ borderRadius: "var(--radius-pill)", ...themed, ...style }}
      {...props}
    >
      {children}
    </span>
  );
}
