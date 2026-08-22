import { useState } from "react";
import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { Button, Badge } from "./ui/index.js";
import Select from "./Select.jsx";
import FormField from "./FormField.jsx";
import {
  useAddDefect,
  useConditionReports,
  useCreateConditionReport,
  useDeleteDefect,
  useDeleteConditionReport,
  usePatchConditionReport,
  useResolveDefect,
} from "../hooks/useConditionReports.js";

const ZONES = ["paint", "joint", "seam", "base", "accessory", "box", "other"];
const CLAIM_STATUSES = ["none", "opened", "refunded", "replaced", "partial", "refused"];
const GRADES = ["A+", "A", "A-", "B+", "B", "C", "J"];

/** Days from today to `iso`, or null. */
function daysTo(iso) {
  if (!iso) return null;
  const d = Math.ceil((new Date(`${iso}T00:00:00`) - new Date()) / 86_400_000);
  return Number.isFinite(d) ? d : null;
}

/** Severity → tone. 3 ruins the piece, 1 is cosmetic. */
const SEVERITY_TONE = { 1: "neutral", 2: "gold", 3: "danger" };

/**
 * 検 Contrôle à réception — a dated damage log per piece, with the two claim
 * countdowns that actually decide whether damage costs you anything.
 *
 * Unboxing is where the money is lost, and `condition` alone is one mutable
 * word with no history: a piece that arrived damaged, was refunded 30% and then
 * repaired reads exactly like one that arrived mint.
 *
 * Defect evidence attaches to the piece's **private documents**, never to
 * catalogue photos — a cracked figure must not leak into a shared vitrine.
 */
export default function ConditionReportSection({ ownedId }) {
  const t = useT();
  const reports = useConditionReports(ownedId);
  const create = useCreateConditionReport(ownedId);
  const patch = usePatchConditionReport(ownedId);
  const removeReport = useDeleteConditionReport(ownedId);
  const addDefect = useAddDefect(ownedId);
  const resolveDefect = useResolveDefect(ownedId);
  const removeDefect = useDeleteDefect(ownedId);

  const [draft, setDraft] = useState(null);

  const list = reports.data ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
        {t("qc.body", {
          default:
            "Consigne l'état à l'ouverture du colis et les défauts constatés. Les deux compte-à-rebours (fenêtre DOA boutique, délai transporteur) te préviennent avant la fermeture.",
        })}
      </p>

      {list.length === 0 ? (
        <p className="text-sm text-[var(--on-surface-subtle)]">
          {t("qc.empty", { default: "Aucun contrôle enregistré." })}
        </p>
      ) : null}

      {list.map((r) => {
        const doa = daysTo(r.doa_deadline);
        const carrier = daysTo(r.carrier_deadline);
        const open = r.claim_status === "none" || r.claim_status === "opened";
        return (
          <article
            key={r.id}
            className="border border-[var(--border)] p-4"
            style={{ borderRadius: "var(--radius-md)" }}
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="micro">
                {t(`qc.kind.${r.kind}`, { default: r.kind })} · {r.reported_on}
              </span>
              <span className="flex items-center gap-2">
                {r.overall_grade ? <Badge tone="gold">{r.overall_grade}</Badge> : null}
                <Badge tone={r.claim_status === "refused" ? "danger" : "neutral"}>
                  {t(`qc.claim.${r.claim_status}`, { default: r.claim_status })}
                </Badge>
                <button
                  type="button"
                  className="tap-target text-[var(--on-surface-subtle)] hover:text-[var(--danger)]"
                  aria-label={t("common.delete", { default: "Supprimer" })}
                  onClick={() => removeReport.mutate(r.id)}
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </header>

            {/* Countdowns only while a claim can still be made. */}
            {open && (doa != null || carrier != null) ? (
              <ul className="mt-2 flex flex-wrap gap-3 text-[11px]">
                {doa != null ? (
                  <li className={doa <= 3 ? "text-[var(--color-laque-bright)]" : ""}>
                    <AlertTriangle size={11} className="inline mr-1" aria-hidden />
                    {t("qc.window.doa", { n: doa, default: `DOA boutique : ${doa} j` })}
                  </li>
                ) : null}
                {carrier != null ? (
                  <li className={carrier <= 3 ? "text-[var(--color-laque-bright)]" : ""}>
                    <AlertTriangle size={11} className="inline mr-1" aria-hidden />
                    {t("qc.window.carrier", { n: carrier, default: `Transporteur : ${carrier} j` })}
                  </li>
                ) : null}
              </ul>
            ) : null}

            {r.note ? (
              <p className="mt-2 text-sm italic text-[var(--on-surface-muted)]">{r.note}</p>
            ) : null}

            {r.defects?.length ? (
              <ul className="mt-3 space-y-1">
                {r.defects.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <Badge tone={SEVERITY_TONE[d.severity] ?? "neutral"}>{d.severity}</Badge>
                    <span className={d.resolved_on ? "line-through opacity-60" : ""}>
                      {t(`qc.zone.${d.zone}`, { default: d.zone })}
                      {d.note ? ` — ${d.note}` : ""}
                    </span>
                    <button
                      type="button"
                      className="tap-target ml-auto text-[var(--on-surface-subtle)] hover:text-[var(--success)]"
                      aria-label={t("qc.resolve", { default: "Marquer réglé" })}
                      onClick={() =>
                        resolveDefect.mutate({
                          id: d.id,
                          resolved_on: d.resolved_on ? null : new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      className="tap-target text-[var(--on-surface-subtle)] hover:text-[var(--danger)]"
                      aria-label={t("common.delete", { default: "Supprimer" })}
                      onClick={() => removeDefect.mutate(d.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <DefectAdder
              t={t}
              onAdd={(defect) => addDefect.mutate({ reportId: r.id, defect })}
              busy={addDefect.isPending}
            />

            <div className="mt-3 max-w-[14rem]">
              <Select
                label={t("qc.field.claim", { default: "Issue de la réclamation" })}
                value={r.claim_status}
                onChange={(v) => patch.mutate({ id: r.id, patch: { claim_status: v } })}
                options={CLAIM_STATUSES.map((s) => ({
                  value: s,
                  label: t(`qc.claim.${s}`, { default: s }),
                }))}
              />
            </div>
          </article>
        );
      })}

      {draft ? (
        <form
          className="border border-[var(--border)] p-4 space-y-3"
          style={{ borderRadius: "var(--radius-md)" }}
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                kind: draft.kind,
                overall_grade: draft.overall_grade || null,
                note: draft.note || null,
                doa_deadline: draft.doa_deadline || null,
                carrier_deadline: draft.carrier_deadline || null,
              },
              { onSuccess: () => setDraft(null) },
            );
          }}
        >
          <div className="grid sm:grid-cols-2 gap-3">
            <Select
              label={t("qc.field.kind", { default: "Type de contrôle" })}
              value={draft.kind}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v }))}
              options={["arrival", "periodic", "post_repair"].map((k) => ({
                value: k,
                label: t(`qc.kind.${k}`, { default: k }),
              }))}
            />
            <Select
              label={t("qc.field.grade", { default: "Note globale" })}
              value={draft.overall_grade}
              onChange={(v) => setDraft((d) => ({ ...d, overall_grade: v }))}
              options={[
                { value: "", label: t("owned.editor.grade.unset", { default: "Non noté" }) },
                ...GRADES.map((g) => ({ value: g, label: g })),
              ]}
            />
            <FormField
              label={t("qc.field.doa", { default: "Fin fenêtre DOA" })}
              type="date"
              value={draft.doa_deadline}
              onChange={(v) => setDraft((d) => ({ ...d, doa_deadline: v }))}
            />
            <FormField
              label={t("qc.field.carrier", { default: "Fin délai transporteur" })}
              type="date"
              value={draft.carrier_deadline}
              onChange={(v) => setDraft((d) => ({ ...d, carrier_deadline: v }))}
            />
          </div>
          <FormField
            label={t("qc.field.note", { default: "Note" })}
            value={draft.note}
            onChange={(v) => setDraft((d) => ({ ...d, note: v }))}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending}>
              {t("common.save", { default: "Enregistrer" })}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
              {t("common.cancel", { default: "Annuler" })}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="subtle"
          iconStart={<Plus size={15} />}
          onClick={() =>
            setDraft({
              kind: "arrival",
              overall_grade: "",
              note: "",
              doa_deadline: "",
              carrier_deadline: "",
            })
          }
        >
          {t("qc.add", { default: "Nouveau contrôle" })}
        </Button>
      )}
    </div>
  );
}

/** Inline "add a defect" row — zone + severity + free note. */
function DefectAdder({ t, onAdd, busy }) {
  const [zone, setZone] = useState("paint");
  const [severity, setSeverity] = useState("1");
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <Select
        label={t("qc.field.zone", { default: "Zone" })}
        value={zone}
        onChange={setZone}
        className="min-w-[9rem]"
        options={ZONES.map((z) => ({ value: z, label: t(`qc.zone.${z}`, { default: z }) }))}
      />
      <Select
        label={t("qc.field.severity", { default: "Gravité" })}
        value={severity}
        onChange={setSeverity}
        className="min-w-[7rem]"
        options={["1", "2", "3"].map((s) => ({
          value: s,
          label: t(`qc.severity.${s}`, { default: s }),
        }))}
      />
      <FormField
        label={t("qc.field.defect_note", { default: "Détail" })}
        value={note}
        onChange={setNote}
        className="flex-1 min-w-[10rem]"
      />
      <Button
        type="button"
        variant="subtle"
        disabled={busy}
        onClick={() => {
          onAdd({ zone, severity: Number(severity), note: note || null });
          setNote("");
        }}
      >
        {t("qc.add_defect", { default: "Ajouter un défaut" })}
      </Button>
    </div>
  );
}
