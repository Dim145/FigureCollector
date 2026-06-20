import { forwardRef } from "react";
import Spinner from "./Spinner.jsx";

const SIZES = { sm: "w-9 h-9", md: "w-11 h-11", lg: "w-12 h-12" };
const GLYPH = { sm: 16, md: 18, lg: 20 };

const VARIANTS = {
  ghost:
    "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)] hover:bg-[var(--surface-sunken)]",
  solid: "text-[var(--color-ivoire)] bg-[var(--primary)] hover:bg-[var(--primary-hover)]",
  outline:
    "text-[var(--on-surface)] border border-[var(--border-strong)] hover:border-[var(--accent)]",
};

/**
 * Icon-only button. `label` is REQUIRED (→ aria-label + title). Always a 44px+
 * (or 36px at sm) circular hit area. forwardRef so it can be a Tooltip /
 * DropdownMenu trigger. Pass a lucide icon component as `icon`.
 */
const IconButton = forwardRef(function IconButton(
  {
    icon: Ic,
    label,
    size = "md",
    variant = "ghost",
    loading = false,
    disabled = false,
    as: Tag = "button",
    type = "button",
    className = "",
    ...props
  },
  ref,
) {
  const isNativeButton = Tag === "button";
  return (
    <Tag
      ref={ref}
      type={isNativeButton ? type : undefined}
      disabled={isNativeButton ? disabled || loading : undefined}
      aria-label={label}
      title={label}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center rounded-full transition-colors duration-[var(--dur-fast)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] disabled:opacity-50 disabled:cursor-not-allowed ${
        SIZES[size] ?? SIZES.md
      } ${VARIANTS[variant] ?? VARIANTS.ghost} ${className}`}
      {...props}
    >
      {loading ? (
        <Spinner size={GLYPH[size] ?? GLYPH.md} />
      ) : Ic ? (
        <Ic size={GLYPH[size] ?? GLYPH.md} strokeWidth={1.75} />
      ) : null}
    </Tag>
  );
});

export default IconButton;
