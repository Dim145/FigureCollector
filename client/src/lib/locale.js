// The app's active UI locale, for Intl-based formatting (Intl.NumberFormat /
// toLocaleString / toLocaleDateString). The i18n provider mirrors the chosen
// language onto `<html lang>` (see i18n/index.jsx), so reading it here makes
// money / number / date formatting follow the app's language instead of the
// browser's — e.g. an EN-browser user who picked Français sees "1 234,56 €",
// not "1,234.56". Returns `undefined` when unset so Intl falls back to the
// runtime default (and to stay safe in any non-DOM context).
export function appLocale() {
  return (
    (typeof document !== "undefined" && document.documentElement.lang) || undefined
  );
}
