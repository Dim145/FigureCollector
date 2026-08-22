import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/index.js";
import { api } from "../../lib/api.js";
import { useT } from "../../i18n/index.jsx";

/** Refuse absurd files client-side so a mis-click can't ship 200 MB upstream. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * 復 Restauration — read a `backup.json` back into the collection.
 *
 * Always previews first: the server runs the whole match in a rolled-back
 * transaction and reports what *would* happen (matched / to create / already
 * on the shelf). Nothing is written until the second, explicit click — an
 * import that silently rewrote a curated collection would be unforgivable.
 */
export default function ImportPanel() {
  const t = useT();
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [backup, setBackup] = useState(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setBackup(null);
    setFileName("");
    setPlan(null);
    setResult(null);
    setError(null);
  };

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    if (file.size > MAX_BYTES) {
      setError(t("restore.err.too_big", { default: "Fichier trop volumineux (max 8 Mo)." }));
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      setBackup(parsed);
      setFileName(file.name);
    } catch {
      setError(t("restore.err.parse", { default: "Ce fichier n'est pas un JSON valide." }));
    }
  };

  const run = async (dryRun) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post("/me/import/backup", {
        dry_run: dryRun,
        create_missing: createMissing,
        policy: "skip",
        backup: { collection: backup?.collection ?? [], wishlist: backup?.wishlist ?? [] },
      });
      if (dryRun) {
        setPlan(res);
      } else {
        setResult(res);
        setPlan(null);
        // The shelf just changed underneath every cached view.
        qc.invalidateQueries();
      }
    } catch (e) {
      setError(e?.message ?? "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-8 border-t border-[var(--border-subtle)] pt-6">
      <p className="micro">{t("restore.kicker", { default: "復 · RESTAURATION" })}</p>
      <h3 className="display text-lg mt-1 text-[var(--color-ivoire)]">
        {t("restore.title", { default: "Réimporter une sauvegarde" })}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--on-surface-muted)] max-w-prose">
        {t("restore.body", {
          default:
            "Relis un fichier backup.json exporté ci-dessus — pour restaurer après incident, migrer d'instance, ou arriver depuis un tableur au même format. Rien n'est écrit avant que tu aies vu l'aperçu.",
        })}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          onChange={onPick}
          className="sr-only"
          id="import-file"
        />
        <Button as="label" htmlFor="import-file" variant="subtle" iconStart={<Upload size={15} />}>
          {t("restore.pick", { default: "Choisir un fichier…" })}
        </Button>
        {fileName ? (
          <span className="text-sm text-[var(--on-surface-muted)] truncate max-w-[18rem]">
            {fileName}
          </span>
        ) : null}
      </div>

      {backup ? (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm text-[var(--on-surface-muted)]">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(e) => setCreateMissing(e.target.checked)}
            />
            {t("restore.create_missing", {
              default: "Créer les figurines absentes du catalogue partagé",
            })}
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => run(true)} disabled={busy} variant="subtle">
              {t("restore.preview", { default: "Aperçu (n'écrit rien)" })}
            </Button>
            {plan ? (
              <Button onClick={() => run(false)} disabled={busy}>
                {t("restore.apply", { default: "Importer maintenant" })}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      {plan ? (
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label={t("restore.stat.collection", { default: "Pièces lues" })} v={plan.collection_rows} />
          <Stat label={t("restore.stat.wishlist", { default: "Souhaits lus" })} v={plan.wishlist_rows} />
          <Stat label={t("restore.stat.matched", { default: "Appariées" })} v={plan.matched_figures} />
          <Stat label={t("restore.stat.new", { default: "À créer" })} v={plan.new_figures} />
          <Stat label={t("restore.stat.present", { default: "Déjà présentes" })} v={plan.already_present} />
        </dl>
      ) : null}

      {result ? (
        <p className="mt-4 text-sm text-[var(--success)]">
          {t("restore.done", {
            c: result.collection_added,
            w: result.wishlist_added,
            f: result.figures_created,
            default: `${result.collection_added} pièce(s), ${result.wishlist_added} souhait(s), ${result.figures_created} figurine(s) créée(s).`,
          })}
        </p>
      ) : null}

      {(plan?.skipped?.length || result?.skipped?.length) ? (
        <ul className="mt-3 text-[12px] text-[var(--on-surface-subtle)] space-y-1">
          {(result?.skipped ?? plan?.skipped ?? []).slice(0, 8).map((s, i) => (
            <li key={i}>· {s}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
    </div>
  );
}

function Stat({ label, v }) {
  return (
    <div>
      <dt className="micro">{label}</dt>
      <dd className="display text-xl tabular-nums text-[var(--color-or)]">{v}</dd>
    </div>
  );
}
