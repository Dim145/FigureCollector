import { forwardRef } from "react";

const SIZES = {
  sm: "px-3 py-2 text-sm min-h-[36px]",
  md: "px-4 py-3 min-h-[44px]",
};

/**
 * Bare text input on semantic tokens (extracted from the old FormField so it's
 * reusable on its own). Use inside <FormField> for label/hint/error, or alone.
 * `size` is the visual variant (not the HTML size attribute).
 */
const Input = forwardRef(function Input(
  { size = "md", invalid = false, className = "", style, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`w-full bg-[var(--surface-sunken)] border text-[var(--on-surface)] outline-none transition-colors duration-[var(--dur-fast)] placeholder:text-[var(--on-surface-subtle)] ${
        SIZES[size] ?? SIZES.md
      } ${
        invalid
          ? "border-[var(--danger)] focus:border-[var(--danger)]"
          : "border-[var(--border)] focus:border-[var(--accent)]"
      } ${className}`}
      style={{
        fontFamily: "var(--font-sans)",
        letterSpacing: "0.01em",
        borderRadius: "var(--radius-sm)",
        ...style,
      }}
      {...props}
    />
  );
});

export default Input;
