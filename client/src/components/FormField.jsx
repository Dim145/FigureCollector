import { useId, isValidElement, cloneElement } from "react";
import Input from "./ui/Input.jsx";

/**
 * Label + control + hint/error wrapper. Wires aria-describedby + aria-invalid.
 *
 * Two ways to use it:
 *   1. Composition (preferred): <FormField label error><Select .../></FormField>
 *      — the single child control is cloned to receive id + aria-describedby +
 *      aria-invalid automatically.
 *   2. Legacy single-input (backward-compatible): pass type/value/onChange/etc.
 *      and it renders an <Input> for you (the old API still works unchanged).
 */
export default function FormField({
  label,
  hint,
  error,
  required = false,
  children,
  className = "",
  // legacy single-input props (used only when no children are provided):
  type = "text",
  value,
  onChange,
  autoComplete,
  disabled = false,
  placeholder,
  name,
  id: idProp,
}) {
  const autoId = useId();
  const id = idProp || autoId;
  const messageId = useId();
  const describedBy = error || hint ? messageId : undefined;

  let control;
  if (children != null) {
    control = isValidElement(children)
      ? cloneElement(children, {
          id: children.props.id ?? id,
          "aria-invalid": error ? true : children.props["aria-invalid"],
          "aria-describedby": children.props["aria-describedby"] ?? describedBy,
        })
      : children;
  } else {
    control = (
      <Input
        id={id}
        name={name}
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        invalid={!!error}
        aria-describedby={describedBy}
      />
    );
  }

  return (
    <div className={className}>
      {label != null ? (
        <label htmlFor={id} className="micro block mb-2">
          {label}
          {required ? <span className="text-[var(--danger)]"> *</span> : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <p
          id={messageId}
          role="alert"
          className="mt-1.5 text-xs text-[var(--danger)] tracking-wide"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1.5 text-xs text-[var(--on-surface-muted)] tracking-wide">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
