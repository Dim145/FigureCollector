import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  usePreorderHistory,
  usePreorders,
  useUpdatePreorder,
} from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";

export default function PreordersPage() {
  const t = useT();
  const me = useMe();
  const preorders = usePreorders();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="max-w-4xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{t("preorders.subtitle")}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("preorders.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        {preorders.data?.length === 0 ? (
          <Card className="max-w-xl mx-auto p-10 text-center">
            <p className="text-[var(--color-ivoire-soft)]">
              {t("preorders.empty")}
            </p>
          </Card>
        ) : (
          <ul className="space-y-5">
            {preorders.data?.map((p) => (
              <PreorderRow key={p.id} preorder={p} t={t} />
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

function PreorderRow({ preorder: p, t }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [newDate, setNewDate] = useState(p.release_date_current ?? "");
  const [note, setNote] = useState("");
  const update = useUpdatePreorder();

  const onSave = async () => {
    await update.mutateAsync({
      id: p.id,
      patch: {
        release_date: newDate || null,
        release_date_note: note || null,
      },
    });
    setEditing(false);
    setNote("");
  };

  const slipLabel =
    p.slip_count === 0
      ? t("preorders.no_slip")
      : p.slip_count === 1
        ? t("preorders.slip_one")
        : t("preorders.slip_many", { n: p.slip_count });

  return (
    <Card className="p-6">
      <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
        <div>
          <p className="micro">{t(`type.${p.figure_type}`)}</p>
          <h2 className="display text-xl text-[var(--color-ivoire)] mt-1">
            {p.figure_name}
          </h2>
          {p.manufacturer_name ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] mt-1">
              {p.manufacturer_name}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-y-2 gap-x-6 text-sm">
            <DetailField label={t("preorders.field.store")} value={p.store} />
            <DetailField label={t("preorders.field.order_ref")} value={p.order_ref} mono />
            <DetailField label={t("preorders.field.status")} value={t(`status.${p.status}`)} />
            <DetailField
              label={t("preorders.field.release_date")}
              value={p.release_date_current ?? "—"}
            />
          </dl>

          {p.release_date_original &&
          p.release_date_original !== p.release_date_current ? (
            <p className="mt-3 text-xs text-[var(--color-or-pale)] tracking-wide">
              {t("preorders.original_was", { date: p.release_date_original })}
            </p>
          ) : null}
        </div>

        <div className="text-right">
          <span
            className={`inline-block px-3 py-1 text-[10px] uppercase tracking-[0.18em] border ${
              p.slip_count > 0
                ? "border-[var(--color-laque-bright)] text-[var(--color-laque-bright)]"
                : "border-[var(--color-or)] text-[var(--color-or)]"
            }`}
          >
            {slipLabel}
          </span>
        </div>
      </div>

      {editing ? (
        <div className="mt-5 pt-5 border-t border-[var(--color-or)]/20 space-y-4">
          <div className="grid sm:grid-cols-[1fr_2fr] gap-4">
            <FormField
              label={t("preorders.bump_date")}
              type="date"
              value={newDate}
              onChange={setNewDate}
            />
            <FormField
              label={t("preorders.bump_note")}
              value={note}
              onChange={setNote}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={update.isPending}
            >
              ×
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              loading={update.isPending}
            >
              ✓
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          {p.slip_count > 0 ? (
            <button
              type="button"
              onClick={() => setHistoryOpen((x) => !x)}
              className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("preorders.history_title")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
          >
            {t("preorders.bump_date")}
          </button>
        </div>
      )}

      {historyOpen ? <PreorderHistory id={p.id} t={t} /> : null}
    </Card>
  );
}

function DetailField({ label, value, mono = false }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-[var(--color-ivoire)] ${
          mono ? "font-mono text-sm tracking-wider" : ""
        }`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

function PreorderHistory({ id, t }) {
  const history = usePreorderHistory(id);
  if (history.isLoading) return null;
  if (!history.data?.length) return null;

  return (
    <div className="mt-5 pt-5 border-t border-[var(--color-or)]/20">
      <p className="micro mb-3">{t("preorders.history_title")}</p>
      <ol className="space-y-2 text-sm text-[var(--color-ivoire-soft)]">
        {history.data.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-3">
            <span className="font-mono text-xs text-[var(--color-or-pale)] tracking-wider whitespace-nowrap">
              {entry.previous_date ?? "?"} → {entry.new_date ?? "?"}
            </span>
            {entry.note ? <span>· {entry.note}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
