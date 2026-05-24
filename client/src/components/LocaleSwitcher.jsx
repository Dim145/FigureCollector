import { useI18n } from "../i18n/index.jsx";

/** Tiny FR / EN toggle for the corner of every page. */
export default function LocaleSwitcher() {
  const { locale, setLocale, supported } = useI18n();
  return (
    <div className="flex items-center gap-1 text-[10px] tracking-[0.25em] uppercase">
      {supported.map((code, i) => (
        <span key={code} className="flex items-center">
          {i > 0 && <span className="mx-1 text-[var(--color-or)]/40">·</span>}
          <button
            type="button"
            onClick={() => setLocale(code)}
            className={`transition-colors ${
              locale === code
                ? "text-[var(--color-or)]"
                : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
            }`}
          >
            {code}
          </button>
        </span>
      ))}
    </div>
  );
}
