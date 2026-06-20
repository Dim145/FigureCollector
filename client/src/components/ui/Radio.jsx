import { useId, createContext, useContext } from "react";

const RadioCtx = createContext(null);

/**
 * Radio group. Wrap <Radio> children; the group owns name + value + onChange.
 *   <RadioGroup label="Condition" value={v} onChange={setV}>
 *     <Radio value="mint" label="Neuf" />
 *     <Radio value="used" label="Occasion" />
 *   </RadioGroup>
 */
export function RadioGroup({ name, value, onChange, label, children, className = "" }) {
  const autoName = useId();
  return (
    <RadioCtx.Provider value={{ name: name || autoName, value, onChange }}>
      <div
        role="radiogroup"
        aria-label={typeof label === "string" ? label : undefined}
        className={className}
      >
        {label != null ? <div className="micro mb-2">{label}</div> : null}
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </RadioCtx.Provider>
  );
}

export function Radio({ value, label, hint, disabled = false, id: idProp, className = "" }) {
  const ctx = useContext(RadioCtx);
  const autoId = useId();
  const id = idProp || autoId;
  const checked = ctx ? ctx.value === value : undefined;
  return (
    <div className={`flex items-start gap-3 ${className}`}>
      <span className="relative inline-flex shrink-0 mt-0.5">
        <input
          id={id}
          type="radio"
          name={ctx?.name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => ctx?.onChange && ctx.onChange(value)}
          className="peer appearance-none w-5 h-5 rounded-full border border-[var(--border-strong)] bg-[var(--surface-sunken)] outline-none transition-colors duration-[var(--dur-fast)] checked:border-[var(--primary)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-raised)] disabled:opacity-50 cursor-pointer"
        />
        <span className="pointer-events-none absolute inset-0 m-auto h-2 w-2 rounded-full bg-[var(--primary)] opacity-0 peer-checked:opacity-100" />
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

export default Radio;
