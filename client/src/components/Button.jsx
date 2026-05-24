/**
 * Direction B buttons.
 *   primary : gold slab, noir text, hover lifts to or-pale
 *   ghost   : transparent, gold border, hover fills with a faint gold wash
 */
export default function Button({
  variant = "primary",
  type = "button",
  disabled = false,
  loading = false,
  children,
  className = "",
  ...props
}) {
  const base =
    "relative overflow-hidden inline-flex items-center justify-center gap-2 px-6 py-3 font-medium tracking-wide magnetic shimmer disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none";

  const variants = {
    primary:
      "bg-[var(--color-or)] text-[var(--color-noir)] hover:bg-[var(--color-or-pale)] active:bg-[var(--color-or)] shadow-[0_10px_25px_-12px_oklch(0.78_0.10_80_/_0.6)]",
    ghost:
      "border border-[var(--color-or)]/40 text-[var(--color-ivoire)] hover:border-[var(--color-or)] hover:bg-[var(--color-or)]/5",
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className="animate-spin"
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
