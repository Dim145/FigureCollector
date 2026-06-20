import { Pencil, RotateCcw } from "lucide-react";
import Money from "../../components/Money.jsx";
import { Button, Input } from "../../components/ui/index.js";

/**
 * The cote (current value) of one piece, in two states — shared by the desktop
 * table rows and the mobile cards so editing behaves identically everywhere.
 *
 *  - read mode: the resolved value + a source badge (Marché / MSRP), a
 *    sign-tinted Δ vs the purchase price, and a pencil affordance. The whole
 *    thing is a ≥44px button that opens the editor.
 *  - edit mode: a currency-prefixed amount field + Save and (Reset-to-MSRP /
 *    Cancel) actions. Enter saves, Escape cancels.
 *
 * `align` controls text alignment (right in the table, left on cards).
 */
export default function CoteValueCell({
  t,
  row,
  editing,
  draft,
  onDraft,
  onStartEdit,
  onSave,
  onCancel,
  onResetMsrp,
  saving,
  align = "right",
}) {
  const { o, ev, deltaAbs } = row;
  const cur = o.value_currency || o.price_currency || ev?.currency || "EUR";
  const alignCls = align === "right" ? "items-end text-right" : "items-start text-left";

  if (editing) {
    return (
      <div className={`flex flex-col gap-2 ${alignCls}`}>
        <div
          className="inline-flex items-center border border-[var(--accent)] bg-[var(--surface-sunken)]"
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <span className="px-2 text-[var(--accent)] font-mono text-xs">{cur}</span>
          <Input
            autoFocus
            inputMode="decimal"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(o);
              if (e.key === "Escape") onCancel();
            }}
            placeholder={o.msrp_amount != null ? String(o.msrp_amount) : "—"}
            aria-label={t("cote.edit_value", { default: "Modifier la valeur" })}
            className="w-24 text-right font-mono !border-0 !bg-transparent"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => onSave(o)} disabled={saving}>
            {t("editor.save", { default: "Enregistrer" })}
          </Button>
          {o.value_amount != null ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onResetMsrp(o)}
              disabled={saving}
              iconStart={<RotateCcw size={13} />}
            >
              MSRP
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              {t("editor.cancel", { default: "Annuler" })}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onStartEdit(o)}
      title={t("cote.edit_value", { default: "Modifier la valeur" })}
      className={`tap-target inline-flex flex-col gap-0.5 group/val ${
        align === "right" ? "ml-auto items-end" : "items-start"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[var(--on-surface)] group-hover/val:text-[var(--accent)] transition-colors">
        <Pencil
          size={12}
          className="text-[var(--on-surface-subtle)] group-hover/val:text-[var(--accent)] transition-colors"
          aria-hidden
        />
        <Money amount={ev.amount} currency={ev.currency} />
        {ev.source === "auto" ? (
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--success)]">
            {t("cote.market_badge", { default: "Marché" })}
          </span>
        ) : ev.source === "msrp" ? (
          <span className="text-[9px] uppercase tracking-[0.14em] text-[var(--accent)]">MSRP</span>
        ) : null}
      </span>
      {deltaAbs != null ? (
        <span
          className="font-mono tabular-nums text-[11px]"
          style={{ color: deltaAbs >= 0 ? "var(--success)" : "var(--danger)" }}
        >
          {deltaAbs >= 0 ? "▲ +" : "▼ −"}
          <Money amount={Math.abs(deltaAbs)} currency={ev.currency} />
        </span>
      ) : null}
    </button>
  );
}
