import { useState } from "react";
import { Input } from "../ui/index.js";

/**
 * Chip editor for a figure's appearance tags (edit mode only). In/out is the
 * comma-separated string the form + server use; the UI shows removable chips
 * and an input where Enter or comma adds (Backspace on an empty input removes
 * the last). Extracted from FigureForm so the form file stays fields-only.
 */
export default function TagsEditor({ value, onChange, disabled, t }) {
  const [draft, setDraft] = useState("");
  const tags = (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const commit = (raw) => {
    const add = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!add.length) return;
    const next = tags.slice();
    for (const tag of add) {
      if (!next.some((x) => x.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    onChange(next.join(", "));
    setDraft("");
  };
  const remove = (tag) => onChange(tags.filter((x) => x !== tag).join(", "));
  return (
    <div>
      <div className="flex flex-wrap gap-2 min-h-[1.75rem]">
        {tags.length === 0 ? (
          <span className="text-sm italic text-[var(--on-surface-subtle)]">
            {t("figure.form.tags.empty", { default: "Aucun tag pour l'instant." })}
          </span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] border border-[var(--border)] bg-[var(--accent)]/5 text-[var(--on-surface)]"
            >
              {tag}
              <button
                type="button"
                disabled={disabled}
                onClick={() => remove(tag)}
                aria-label={t("figure.form.tags.remove", { tag, default: `Retirer ${tag}` })}
                className="text-[var(--danger)]/70 hover:text-[var(--danger)] leading-none text-base disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <Input
        type="text"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
        placeholder={t("figure.form.tags.add", {
          default: "Ajouter un tag — Entrée ou virgule pour valider…",
        })}
        className="mt-3"
      />
    </div>
  );
}
