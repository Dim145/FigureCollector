import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useMe } from "../../hooks/useMe.js";
import { useFigureDuplicates } from "../../hooks/useCollection.js";
import { typeHue, typeKanji } from "../../lib/typeHue.js";

/**
 * Live "about to create a duplicate?" panel (create mode only). Debounces the
 * name/JAN, queries the catalogue, and surfaces strong (same JAN) and soft
 * (same name) matches with a link to the existing figure (opened in a new tab
 * so the in-progress form is preserved).
 *
 * Extracted from FigureForm so the form file stays fields-only.
 */
export default function DuplicateWarning({ name, jan, t }) {
  const [dq, setDq] = useState({ name: "", jan: "" });
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDq({ name: name ?? "", jan: jan ?? "" }), 400);
    return () => clearTimeout(id);
  }, [name, jan]);
  useEffect(() => {
    setDismissed(false);
  }, [dq.name, dq.jan]);

  const me = useMe();
  const nsfwBlur = (me.data?.user?.nsfw_visibility ?? "hide") === "blur";
  const { data } = useFigureDuplicates(dq.name, dq.jan);
  const matches = data ?? [];
  const enteredJan = dq.jan.trim();
  if (dismissed || matches.length === 0) return null;

  return (
    <div className="border border-[var(--border-strong)] bg-[var(--accent)]/5">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <TriangleAlert size={15} className="text-[var(--accent)]" aria-hidden />
        <span className="display text-base text-[var(--on-surface)]">
          {t("figdup.title", { n: matches.length })}
        </span>
      </div>
      <ul>
        {matches.map((m) => {
          const strong = !!enteredJan && m.jan === enteredJan;
          const hue = typeHue(m.figure_type);
          return (
            <li
              key={m.id}
              className="grid grid-cols-[40px_1fr_auto] gap-3 items-center px-4 py-2.5 border-b border-[var(--border-subtle)] last:border-0"
            >
              <span
                className="relative w-10 h-[50px] border overflow-hidden grid place-items-center"
                style={{ borderColor: `color-mix(in oklab, ${hue} 30%, transparent)` }}
              >
                {m.official_image_url ? (
                  <img
                    src={m.official_image_url}
                    alt=""
                    loading="lazy"
                    className={`absolute inset-0 w-full h-full object-cover ${
                      m.is_nsfw && nsfwBlur ? "nsfw-blur" : ""
                    }`}
                  />
                ) : (
                  <span
                    aria-hidden
                    className="ja text-lg"
                    style={{ color: `color-mix(in oklab, ${hue} 55%, transparent)` }}
                  >
                    {typeKanji(m.figure_type)}
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block display text-base text-[var(--on-surface)] leading-tight truncate">
                  {m.name}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--on-surface-muted)]">
                  <span
                    className={strong ? "chip chip--laque" : "chip"}
                    style={{ padding: "0.1em 0.45em", fontSize: "8.5px" }}
                  >
                    {strong ? t("figdup.badge_jan") : t("figdup.badge_name")}
                  </span>
                  {m.manufacturer_name ? (
                    <span className="font-mono truncate">{m.manufacturer_name}</span>
                  ) : null}
                </span>
              </span>
              <a
                href={`/figures/${m.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] uppercase tracking-[0.14em] border border-[var(--border-strong)] text-[var(--color-or-pale)] px-2.5 py-1.5 whitespace-nowrap hover:border-[var(--accent)] transition-colors"
              >
                {t("figdup.open")} →
              </a>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end px-4 py-2.5">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-[10px] uppercase tracking-[0.14em] text-[var(--on-surface-muted)] hover:text-[var(--accent)] transition-colors"
        >
          {t("figdup.proceed")}
        </button>
      </div>
    </div>
  );
}
