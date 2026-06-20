import { useId } from "react";

/**
 * Native <select> styled with the Direction-A gold-rim + noir treatment, on
 * semantic tokens. Keeps the native control (best mobile + a11y behaviour).
 * Backward-compatible API (label/value/onChange/options/required/disabled/hint)
 * plus optional error/name/id.
 */
export default function Select({
  label,
  value,
  onChange,
  options = [],
  required = false,
  disabled = false,
  hint,
  error,
  name,
  id: idProp,
  className = "",
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const msgId = useId();
  const describedBy = error || hint ? msgId : undefined;
  return (
    <div className={className}>
      {label != null ? (
        <label htmlFor={id} className="micro block mb-2">
          {label}
          {required ? <span className="text-[var(--danger)]"> *</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <select
          id={id}
          name={name}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`appearance-none w-full bg-[var(--surface-sunken)] border px-4 py-3 pr-10 text-[var(--on-surface)] outline-none transition-colors duration-[var(--dur-fast)] disabled:opacity-60 ${
            error
              ? "border-[var(--danger)] focus:border-[var(--danger)]"
              : "border-[var(--border)] focus:border-[var(--accent)]"
          }`}
          style={{
            fontFamily: "var(--font-sans)",
            letterSpacing: "0.01em",
            borderRadius: "var(--radius-sm)",
            minHeight: "44px",
          }}
        >
          {options.map((o) => (
            <option
              key={o.value}
              value={o.value}
              className="bg-[var(--surface)] text-[var(--on-surface)]"
            >
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-or-pale)]"
          width="12"
          height="12"
          viewBox="0 0 12 12"
        >
          <path d="M2 4 L6 8 L10 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      {error ? (
        <p id={msgId} role="alert" className="mt-1.5 text-xs text-[var(--danger)] tracking-wide">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="mt-1.5 text-xs text-[var(--on-surface-muted)] tracking-wide">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
