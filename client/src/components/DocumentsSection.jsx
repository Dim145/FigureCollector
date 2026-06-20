import { useRef, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useOwnedDocuments,
  useUploadDocument,
  useDeleteDocument,
  useParseDocument,
} from "../hooks/useDocuments.js";
import { useUpdateOwnedItem } from "../hooks/useCollection.js";

const ACCEPT = ".pdf,image/jpeg,image/png,image/webp";

function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

/** "168.00 USD" — amounts arrive as decimal strings from the API. */
function fmtAmount(v, currency) {
  if (v == null || v === "") return "";
  return currency ? `${v} ${currency}` : `${v}`;
}

function noteKey(note) {
  if (note === "image_no_text_layer") return "doc.parse.note.image";
  if (note === "no_text_found") return "doc.parse.note.no_text";
  return "doc.parse.note.failed";
}

/**
 * Owner-only "Pièces justificatives" — attach receipts / invoices / customs
 * slips (PDF or image) to an owned item. Private: the list + the per-file proxy
 * (`/api/documents/{id}`) are gated to the owner server-side.
 *
 * For PDFs, "Extraire les infos" parses the text layer (Palier 1: pure-Rust,
 * offline) and proposes purchase fields + a cumulative "total payé" across all
 * the item's invoices (deposit + balance + freight). Nothing is written until
 * the user clicks "Appliquer".
 */
export default function DocumentsSection({ ownedId }) {
  const t = useT();
  const docs = useOwnedDocuments(ownedId);
  const upload = useUploadDocument(ownedId);
  const del = useDeleteDocument(ownedId);
  const parse = useParseDocument(ownedId);
  const updateOwned = useUpdateOwnedItem();
  const inputRef = useRef(null);
  const [error, setError] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [result, setResult] = useState(null); // { docId, extracted, note, rollup }
  const [applied, setApplied] = useState(false);

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

  const onParse = async (docId) => {
    setError(null);
    setApplied(false);
    setBusyId(docId);
    try {
      const res = await parse.mutateAsync(docId);
      setResult({ docId, ...res });
    } catch (err) {
      setError(err?.message ?? t("doc.parse.note.failed"));
    } finally {
      setBusyId(null);
    }
  };

  const buildPatch = (r) => {
    const patch = {};
    if (!r) return patch;
    if (r.store) patch.store = r.store;
    if (r.earliest_date) patch.purchase_date = r.earliest_date;
    if (!r.mixed_currency && r.currency) {
      patch.price_currency = r.currency;
      if (r.article_total != null && Number(r.article_total) > 0)
        patch.price_amount = Number(r.article_total);
      if (r.shipping_total != null && Number(r.shipping_total) > 0)
        patch.shipping_amount = Number(r.shipping_total);
    }
    return patch;
  };

  const onApply = () => {
    const patch = buildPatch(result?.rollup);
    if (Object.keys(patch).length === 0) return;
    updateOwned.mutate(
      { id: ownedId, patch },
      {
        onSuccess: () => setApplied(true),
        onError: (e) => setError(e?.message ?? t("doc.error")),
      },
    );
  };

  const items = docs.data ?? [];
  const locale = document.documentElement.lang || undefined;
  const fmtDate = (s) => (s ? new Date(s).toLocaleDateString(locale) : "");

  const r = result?.rollup;
  const canApply = !!(
    r &&
    (r.store || r.earliest_date || (!r.mixed_currency && r.currency))
  );

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
            const when = d.created_at ? fmtDate(d.created_at) : "";
            const meta = d.parsed_metadata;
            return (
              <li
                key={d.id}
                className="flex flex-col gap-2 p-3 border border-[color-mix(in_oklab,var(--color-or)_14%,transparent)] bg-[var(--color-noir-soft)]"
              >
                <div className="flex items-center gap-3">
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
                  {isPdf ? (
                    <button
                      type="button"
                      onClick={() => onParse(d.id)}
                      disabled={busyId === d.id}
                      className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-indigo)] hover:text-[var(--color-ivoire)] disabled:opacity-50"
                    >
                      {busyId === d.id ? t("doc.parsing") : `✦ ${t("doc.parse")}`}
                    </button>
                  ) : null}
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
                </div>
                {meta && (meta.amount || meta.role) ? (
                  <p className="text-[10px] text-[var(--color-or-pale)] pl-12">
                    ✓ {fmtAmount(meta.amount, meta.currency)}
                    {meta.role ? ` · ${t(`doc.role.${meta.role}`)}` : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {result ? (
        <div className="border border-[color-mix(in_oklab,var(--color-indigo)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-indigo)_5%,transparent)] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-indigo)]">
              {t("doc.parse.title")}
            </h4>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)]"
            >
              {t("doc.parse.close")}
            </button>
          </div>

          {result.note ? (
            <p className="text-[12px] text-[var(--color-ivoire-soft)]">
              {t(noteKey(result.note))}
            </p>
          ) : null}

          {result.extracted ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <Field
                label={t("doc.parse.invoice_number")}
                value={result.extracted.invoice_number}
              />
              <Field
                label={t("doc.parse.order_number")}
                value={result.extracted.order_number}
              />
              <Field
                label={t("doc.parse.amount")}
                value={
                  result.extracted.amount
                    ? fmtAmount(
                        result.extracted.amount,
                        result.extracted.currency,
                      ) + (result.extracted.currency_guess ? " (?)" : "")
                    : null
                }
              />
              <Field
                label={t("doc.parse.date")}
                value={fmtDate(
                  result.extracted.paid_on || result.extracted.invoice_date,
                )}
              />
              <Field
                label={t("doc.parse.item")}
                value={result.extracted.item_label}
              />
              <Field
                label={t("doc.parse.store")}
                value={result.extracted.store}
              />
            </dl>
          ) : null}

          {r && r.parsed_count > 0 ? (
            <div className="space-y-1 border-t border-[color-mix(in_oklab,var(--color-or)_14%,transparent)] pt-2">
              {r.mixed_currency ? (
                <p className="text-[12px] text-[var(--color-laque-bright)]">
                  {t("doc.parse.mixed_currency")}
                </p>
              ) : r.currency ? (
                <div className="text-[12px] text-[var(--color-ivoire)] space-y-0.5">
                  <p>
                    {t("doc.parse.rollup.article")} ·{" "}
                    {fmtAmount(r.article_total, r.currency)}
                  </p>
                  {Number(r.shipping_total) > 0 ? (
                    <p>
                      {t("doc.parse.rollup.shipping")} ·{" "}
                      {fmtAmount(r.shipping_total, r.currency)}
                    </p>
                  ) : null}
                  <p className="text-[var(--color-or)] font-medium">
                    {t("doc.parse.rollup")} ·{" "}
                    {fmtAmount(r.total_paid, r.currency)}
                  </p>
                </div>
              ) : null}
              <p className="text-[10px] text-[var(--color-ivoire-soft)]">
                {t("doc.parse.count", { n: r.parsed_count })}
                {r.order_numbers?.length
                  ? ` · ${t("doc.parse.order_number")} ${r.order_numbers.join(", ")}`
                  : ""}
                {r.currency_guess ? ` · ${t("doc.parse.currency_guess")}` : ""}
              </p>

              {applied ? (
                <p className="text-[12px] text-[var(--color-or)]">
                  {t("doc.parse.applied")}
                </p>
              ) : canApply ? (
                <button
                  type="button"
                  onClick={onApply}
                  disabled={updateOwned.isPending}
                  className="mt-1 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] border border-[var(--color-indigo)] text-[var(--color-indigo)] hover:bg-[color-mix(in_oklab,var(--color-indigo)_12%,transparent)] disabled:opacity-50"
                >
                  {t("doc.parse.apply")}
                </button>
              ) : null}
            </div>
          ) : !result.extracted && !result.note ? (
            <p className="text-[12px] text-[var(--color-ivoire-soft)]">
              {t("doc.parse.nothing")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A label/value pair in the review grid — renders nothing when value is empty. */
function Field({ label, value }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-[var(--color-ivoire-soft)]">{label}</dt>
      <dd className="text-[var(--color-ivoire)] break-words">{value}</dd>
    </>
  );
}
