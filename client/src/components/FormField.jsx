import { useId } from "react";

export default function FormField({
  label,
  hint,
  type = "text",
  value,
  onChange,
  error,
  autoComplete,
  required = false,
  disabled = false,
  placeholder,
  name,
}) {
  const id = useId();
  // Stable IDs for the hint + error nodes so we can wire them up via
  // `aria-describedby` (screen readers announce the description right
  // after the label) and flip `aria-invalid` when validation fails.
  // Previously these existed only visually — SR users entering the
  // field never heard the error message.
  const messageId = useId();

  return (
    <div>
      <label htmlFor={id} className="block">
        <span className="micro block mb-2">{label}</span>
        <input
          id={id}
          name={name}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? messageId : undefined}
          className={`w-full bg-[var(--color-noir)] border px-4 py-3 text-[var(--color-ivoire)] outline-none transition-colors duration-200 ${
            error
              ? "border-[var(--color-laque-bright)] focus:border-[var(--color-laque-bright)]"
              : "border-[var(--color-or)]/30 focus:border-[var(--color-or)]"
          }`}
          style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.01em" }}
        />
      </label>
      {error ? (
        <p
          id={messageId}
          role="alert"
          className="mt-1.5 text-xs text-[var(--color-laque-bright)] tracking-wide"
        >
          {error}
        </p>
      ) : hint ? (
        <p
          id={messageId}
          className="mt-1.5 text-xs text-[var(--color-ivoire-soft)] tracking-wide"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
