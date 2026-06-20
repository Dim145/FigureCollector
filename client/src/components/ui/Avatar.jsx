/**
 * User / entity avatar with initial fallback. Square-ish circular, tokenised.
 */
const SIZES = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
};

export default function Avatar({ src, name = "", size = "md", className = "", ...props }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full overflow-hidden border border-[var(--border)] bg-[var(--surface-sunken)] text-[var(--on-surface-muted)] font-medium shrink-0 ${
        SIZES[size] ?? SIZES.md
      } ${className}`}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={name ? `Avatar de ${name}` : ""}
          className="w-full h-full object-cover"
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
    </span>
  );
}
