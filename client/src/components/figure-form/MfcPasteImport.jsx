import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button, Textarea } from "../ui/index.js";
import { api } from "../../lib/api.js";
import { mapMfcItem, MFC_HOME } from "./lookupSources.js";

/**
 * MFC import-by-paste body (the "MFC" tab). MyFigureCollection's search/scrape
 * is Cloudflare-blocked, so the user opens the page on myfigurecollection.net,
 * pastes its HTML here, and we parse it server-side then prefill the form.
 *
 * Renders inline (the parent tabs shell is already a <Modal>): a paste textarea
 * → "Analyser" → a "champs trouvés" confirmation grid → "Pré-remplir".
 *
 * @param {(payload: object) => void} props.onApply
 * @param {(key, opts?) => string} props.t
 */
export default function MfcPasteImport({ onApply, t }) {
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [item, setItem] = useState(null);

  const analyse = () => {
    setBusy(true);
    setError(null);
    api.post("/external/mfc/parse", { html }).then(
      (it) => {
        setItem(it);
        setBusy(false);
      },
      (e) => {
        setError(e?.message ?? "parse failed");
        setBusy(false);
      },
    );
  };

  const rows = item
    ? [
        ["name", item.name],
        ["manufacturer", item.manufacturer],
        ["sculptor", item.sculptor],
        ["scale", item.scale],
        ["release", item.release_date],
        ["price", item.release_price_jpy != null ? `${item.release_price_jpy} ¥` : null],
        ["jan", item.jan],
      ].filter(([, v]) => !!v)
    : [];

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-[var(--on-surface-muted)] border-l-2 border-[var(--border-strong)] pl-3">
        {t("mfc.note")}{" "}
        <a
          href={MFC_HOME}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] hover:underline whitespace-nowrap"
        >
          myfigurecollection.net ↗
        </a>
      </p>

      {!item ? (
        <>
          <Textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            placeholder={t("mfc.textarea_ph")}
            rows={12}
            className="font-mono text-[11px]"
            aria-label={t("mfc.title")}
          />
          {error ? (
            <p role="alert" className="text-xs text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="primary"
              type="button"
              loading={busy}
              disabled={!html.trim()}
              onClick={analyse}
            >
              {t("mfc.analyse")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 text-xs text-[var(--success)]">
            <CircleCheck size={14} aria-hidden />
            {t("mfc.parsed", { id: item.mfc_id || "?" })}
          </p>
          <FoundFields rows={rows} keyPrefix="mfc.field" t={t} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => setItem(null)}>
              {t("mfc.recoller")}
            </Button>
            <Button variant="primary" type="button" onClick={() => onApply(mapMfcItem(item))}>
              {t("mfc.prefill")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** "Champs trouvés pré-remplis" confirmation grid — what a pick will write into
 *  the form. Shared shape: `[ [key, value], … ]` + a label-key prefix. */
export function FoundFields({ rows, keyPrefix, t }) {
  if (!rows?.length) return null;
  return (
    <div className="border border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3">
      <p className="micro-tight mb-2 text-[var(--color-or-pale)]">
        {t("lookup.figure.found_fields", { default: "Champs trouvés — pré-remplis" })}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[9px] uppercase tracking-[0.16em] text-[var(--color-or-pale)] self-center">
              {t(`${keyPrefix}.${k}`)}
            </dt>
            <dd className="m-0 font-mono text-[12px] text-[var(--on-surface)] truncate">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
