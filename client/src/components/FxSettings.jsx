import { useT } from "../i18n/index.jsx";
import { useDisplayCurrency } from "./DisplayCurrencyProvider.jsx";

/**
 * The single display-currency switch (Settings → 銭). The preferred currency
 * selected just above IS the display currency; this toggle only chooses whether
 * amounts in other currencies are converted into it at today's ECB rate (on —
 * the default) or kept in their own currency (off). Originals are always
 * preserved and shown on hover. State lives in DisplayCurrencyProvider, so the
 * whole app re-renders the instant it flips — no second Select, no manual
 * overrides (both dropped in the pricing refonte).
 */
export default function FxSettings() {
  const t = useT();
  const { display, convertEnabled, setConvertEnabled } = useDisplayCurrency();

  return (
    <div className="mt-6 pt-6 border-t border-dashed border-[var(--color-or)]/20">
      <div className="atelier-toggle-row">
        <div id="toggle-label-fx" className="atelier-toggle-row-text">
          <span
            className={`atelier-toggle-row-state ${convertEnabled ? "is-on" : ""}`}
          >
            {convertEnabled ? t("fx.convertOn") : t("fx.convertOff")}
          </span>
          <span className="atelier-toggle-row-hint">
            {convertEnabled
              ? t("fx.convertOnHint", { cur: display || "—" })
              : t("fx.convertOffHint")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={convertEnabled}
          aria-labelledby="toggle-label-fx"
          onClick={() => setConvertEnabled(!convertEnabled)}
          className={`atelier-toggle ${convertEnabled ? "is-on" : ""}`}
        />
      </div>
      <p className="atelier-select-hint mt-4">{t("fx.hint")}</p>
      {!display ? (
        <p className="atelier-select-hint mt-1 text-[var(--color-or-pale)]">
          {t("fx.noPreferred")}
        </p>
      ) : null}
    </div>
  );
}
