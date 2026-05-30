import { useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useOwnedDocuments,
  useUploadDocument,
  useDeleteDocument,
} from "../hooks/useDocuments.js";

const ACCEPT = ".pdf,image/jpeg,image/png,image/webp";

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/**
 * Owner-only "Pièces justificatives" — attach receipts / invoices / customs
 * slips (PDF or image) to an owned item. Private: the list + the per-file proxy
 * (`/api/documents/{id}`) are gated to the owner server-side.
 */
export default function DocumentsSection({ ownedId }) {
  const t = useT();
  const docs = useOwnedDocuments(ownedId);
  const upload = useUploadDocument(ownedId);
  const del = useDeleteDocument(ownedId);
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      await upload.mutateAsync(file);
    } catch (err) {
      setError(err?.message ?? t("doc.error"));
    }
  };

  const items = docs.data ?? [];
  const locale = document.documentElement.lang || undefined;

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={onPick}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="w-full border border-dashed border-[color-mix(in_oklab,var(--color-indigo)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-indigo)_6%,transparent)] py-4 text-[13px] text-[var(--color-ivoire-soft)] hover:border-[var(--color-indigo)] transition-colors disabled:opacity-50"
      >
        {upload.isPending ? t("doc.uploading") : `↑ ${t("doc.add")}`}
      </button>

      {error ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3"
        >
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ivoire-soft)] italic">
          {t("doc.empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((d) => {
            const isPdf = (d.mime || "").includes("pdf");
            const when = d.created_at
              ? new Date(d.created_at).toLocaleDateString(locale)
              : "";
            return (
              <li
                key={d.id}
                className="flex items-center gap-3 p-3 border border-[color-mix(in_oklab,var(--color-or)_14%,transparent)] bg-[var(--color-noir-soft)]"
              >
                <span
                  aria-hidden
                  className="w-9 h-9 grid place-items-center border border-[color-mix(in_oklab,var(--color-indigo)_45%,transparent)] text-[var(--color-indigo)] font-mono text-[9px]"
                >
                  {isPdf ? "PDF" : "IMG"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[var(--color-ivoire)] truncate">
                    {d.filename}
                  </p>
                  <p className="text-[10px] text-[var(--color-ivoire-soft)]">
                    {[fmtSize(d.size_bytes), when].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <a
                  href={`/api/documents/${d.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-or-pale)] hover:text-[var(--color-or)]"
                >
                  {t("doc.view")}
                </a>
                {confirmId === d.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        del.mutate(d.id);
                        setConfirmId(null);
                      }}
                      className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-laque-bright)]"
                    >
                      {t("doc.confirm")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)]"
                    >
                      {t("editor.cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(d.id)}
                    className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)]"
                  >
                    {t("doc.delete")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
