import { useId } from "react";
import { Check, Minus } from "lucide-react";

/**
 * Checkbox with a custom box + lucide check / indeterminate glyph. A native
 * <input type=checkbox> sits under the hood (form + a11y semantics intact);
 * the optional label is clickable.
 */
export default function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  label,
  hint,
  disabled = false,
  invalid = false,
  id: idProp,
  className = "",
  ...props
}) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <span className="relative inline-flex shrink-0 mt-0.5">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          ref={(el) => {
            if (el) el.indeterminate = indeterminate;
          }}
          onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
          className="peer appearance-none w-5 h-5 border border-[var(--border-strong)] bg-[var(--surface-sunken)] outline-none transition-colors duration-[var(--dur-fast)] checked:bg-[var(--primary)] checked:border-[var(--primary)] indeterminate:bg-[var(--primary)] indeterminate:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] disabled:opacity-50 cursor-pointer"
          style={{
            borderRadius: "var(--radius-sm)",
            borderColor: invalid ? "var(--danger)" : undefined,
          }}
          {...props}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--color-ivoire)] opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100">
          {indeterminate ? (
            <Minus size={14} strokeWidth={3} />
          ) : (
            <Check size={14} strokeWidth={3} />
          )}
        </span>
      </span>
      {label != null ? (
        <label htmlFor={id} className="text-sm text-[var(--on-surface)] cursor-pointer select-none">
          {label}
          {hint ? (
            <span className="block text-xs text-[var(--on-surface-muted)] mt-0.5">{hint}</span>
          ) : null}
        </label>
      ) : null}
    </div>
  );
}
