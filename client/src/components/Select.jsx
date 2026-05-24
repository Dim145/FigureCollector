import { useId } from "react";

/**
 * Direction B styled <select>. Keeps the native control but wraps it with the
 * same gold-rim + noir look as FormField inputs.
 */
export default function Select({
  label,
  value,
  onChange,
  options,
  required = false,
  disabled = false,
  hint,
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block">
        <span className="micro block mb-2">{label}</span>
        <div className="relative">
          <select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required={required}
            disabled={disabled}
            className="appearance-none w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 pr-10 text-[var(--color-ivoire)] outline-none transition-colors focus:border-[var(--color-or)] disabled:opacity-60"
            style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.01em" }}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value} className="bg-[var(--color-noir)] text-[var(--color-ivoire)]">
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
            <path
              d="M2 4 L6 8 L10 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </div>
      </label>
      {hint ? (
        <p className="mt-1.5 text-xs text-[var(--color-ivoire-soft)] tracking-wide">{hint}</p>
      ) : null}
    </div>
  );
}
