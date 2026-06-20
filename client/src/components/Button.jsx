import Spinner from "./ui/Spinner.jsx";

/**
 * Direction A button (refined).
 *   primary : hanko-red pill (--primary), ivoire text, hover → --primary-hover
 *   danger  : solid --danger pill (replaces the old ConfirmDialog `!bg` hack)
 *   ghost   : transparent, gold border, faint gold wash on hover
 *   subtle  : quiet text button, surface tint on hover (tertiary actions)
 *
 * Backward-compatible with the previous API (primary|ghost, size md|sm,
 * loading, per-call className wins). Adds: danger|subtle variants, lg size,
 * polymorphic `as` (e.g. react-router Link), iconStart/iconEnd (pass a node),
 * and aria-busy while loading.
 */
const SIZES = {
  sm: "px-4 py-2 text-[11px] tracking-[0.16em] min-h-[36px]",
  md: "px-6 py-3 min-h-[44px]",
  lg: "px-8 py-4 text-[15px] min-h-[52px]",
};

const VARIANTS = {
  primary:
    "text-[var(--color-ivoire)] bg-[var(--primary)] hover:bg-[var(--primary-hover)] active:bg-[var(--primary)] shadow-[0_10px_28px_-12px_oklch(0.62_0.19_25_/_0.5)]",
  danger:
    "text-[var(--color-ivoire)] bg-[var(--danger)] hover:brightness-110 active:brightness-100",
  ghost:
    "text-[var(--on-surface)] border border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/5",
  subtle: "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)] hover:bg-[var(--surface)]",
};

export default function Button({
  variant = "primary",
  size = "md",
  type = "button",
  as: Tag = "button",
  disabled = false,
  loading = false,
  iconStart = null,
  iconEnd = null,
  children,
  className = "",
  ...props
}) {
  const base =
    "relative overflow-hidden inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-wide magnetic shimmer transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none";
  const isNativeButton = Tag === "button";
  return (
    <Tag
      type={isNativeButton ? type : undefined}
      disabled={isNativeButton ? disabled || loading : undefined}
      aria-disabled={!isNativeButton && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={`${base} ${SIZES[size] ?? SIZES.md} ${VARIANTS[variant] ?? VARIANTS.primary} ${className}`}
      {...props}
    >
      {loading ? <Spinner size={16} /> : iconStart}
      {children}
      {!loading ? iconEnd : null}
    </Tag>
  );
}
