import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { getPref, setPref } from "../lib/userPrefs.js";
import { FX_CURRENCIES } from "../hooks/useFx.js";
import Select from "./Select.jsx";

/**
 * Optional display-currency conversion controls (in the Settings "Devise"
 * drawer). Prefs are client-side (localStorage) — a display convenience, not
 * collection truth. Rates come from the cached /external/fx proxy (ECB); the
 * per-currency manual overrides here win over the API when set.
 */
export default function FxSettings() {
  const t = useT();
  const [convert, setConvert] = useState(() => getPref("fxConvert") === true);
  const [display, setDisplay] = useState(() =>
    (getPref("fxDisplay") || "EUR").toUpperCase(),
  );
  const [overrides, setOverrides] = useState(() => getPref("fxOverrides") || {});

  const toggle = () => {
    const v = !convert;
    setConvert(v);
    setPref("fxConvert", v);
  };
  const onDisplay = (v) => {
    setDisplay(v);
    setPref("fxDisplay", v);
  };
  const onOverride = (cur, raw) => {
    const next = { ...overrides };
    const n = parseFloat(String(raw).replace(",", "."));
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) delete next[cur];
    else next[cur] = n;
    setOverrides(next);
    setPref("fxOverrides", next);
  };

  return (
    <div className="mt-6 pt-6 border-t border-dashed border-[var(--color-or)]/20">
      <div className="atelier-toggle-row">
        <div id="toggle-label-fx" className="atelier-toggle-row-text">
          <span className={`atelier-toggle-row-state ${convert ? "is-on" : ""}`}>
            {convert ? t("fx.on") : t("fx.off")}
          </span>
          <span className="atelier-toggle-row-hint">{t("fx.convert")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={convert}
          aria-labelledby="toggle-label-fx"
          onClick={toggle}
          className={`atelier-toggle ${convert ? "is-on" : ""}`}
        />
      </div>

      {convert ? (
        <>
          <div className="atelier-select-wrap mt-4">
            <Select
              label={t("fx.display")}
              value={display}
              onChange={onDisplay}
              options={FX_CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
          <p className="atelier-select-hint">{t("fx.hint")}</p>

          <p className="micro mt-5 mb-2">{t("fx.overrides")}</p>
          <div className="space-y-2">
            {FX_CURRENCIES.filter((c) => c !== display).map((c) => (
              <label key={c} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-[var(--color-ivoire-soft)] w-20">
                  1 {c} =
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  defaultValue={overrides[c] != null ? String(overrides[c]) : ""}
                  onChange={(e) => onOverride(c, e.target.value)}
                  placeholder={t("fx.auto")}
                  className="flex-1 bg-[var(--color-noir)] border border-[var(--color-or)]/25 px-3 py-1.5 text-[var(--color-ivoire)] font-mono outline-none focus:border-[var(--color-or)]"
                />
                <span className="font-mono text-[var(--color-or-pale)] w-12">
                  {display}
                </span>
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
