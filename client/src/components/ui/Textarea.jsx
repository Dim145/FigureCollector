import { forwardRef } from "react";

/**
 * Multiline text input, same token treatment as <Input>.
 */
const Textarea = forwardRef(function Textarea(
  { invalid = false, rows = 4, className = "", style, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={`w-full bg-[var(--surface-sunken)] border px-4 py-3 text-[var(--on-surface)] outline-none transition-colors duration-[var(--dur-fast)] placeholder:text-[var(--on-surface-subtle)] resize-y ${
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

export default Textarea;
