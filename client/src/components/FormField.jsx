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
          className={`w-full bg-[var(--color-noir)] border px-4 py-3 text-[var(--color-ivoire)] outline-none transition-colors duration-200 ${
            error
              ? "border-[var(--color-laque-bright)] focus:border-[var(--color-laque-bright)]"
              : "border-[var(--color-or)]/30 focus:border-[var(--color-or)]"
          }`}
          style={{ fontFamily: "var(--font-sans)", letterSpacing: "0.01em" }}
        />
      </label>
      {error ? (
        <p className="mt-1.5 text-xs text-[var(--color-laque-bright)] tracking-wide">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-[var(--color-ivoire-soft)] tracking-wide">{hint}</p>
      ) : null}
    </div>
  );
}
