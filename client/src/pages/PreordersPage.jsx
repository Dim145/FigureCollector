import { useEffect, useState } from "react";
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
import Select from "../components/Select.jsx";
import TrackingChip from "../components/TrackingChip.jsx";

/** Status values the server's allow-list accepts. Order matters — it's
 *  also the lifecycle the dropdown presents top-to-bottom. */
const STATUS_OPTIONS = [
  "announced",
  "preorder_open",
  "preordered",
  "in_production",
  "released",
  "shipped",
  "received",
  "cancelled",
];

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

// ─────────────────────────────────────────────────────────────────────────────

function PreorderRow({ preorder: p, t }) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const slipLabel =
    p.slip_count === 0
      ? t("preorders.no_slip")
      : p.slip_count === 1
        ? t("preorders.slip_one")
        : t("preorders.slip_many", { n: p.slip_count });

  return (
    <Card className="p-6">
      <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
        <div className="min-w-0">
          <p className="micro">{t(`type.${p.figure_type}`)}</p>
          <h2 className="display text-xl text-[var(--color-ivoire)] mt-1">
            {p.figure_name}
          </h2>
          {p.manufacturer_name ? (
            <p className="text-sm text-[var(--color-ivoire-soft)] mt-1">
              {p.manufacturer_name}
            </p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-6 text-sm">
            <DetailField label={t("preorders.field.store")} value={p.store} />
            <DetailField
              label={t("preorders.field.order_ref")}
              value={p.order_ref}
              mono
            />
            <DetailField
              label={t("preorders.field.status")}
              value={
                <StatusPill status={p.status} t={t} />
              }
            />
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

          {p.tracking_url ? (
            <div className="mt-4 max-w-md">
              <TrackingChip url={p.tracking_url} />
            </div>
          ) : null}
        </div>

        <div className="text-right shrink-0">
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
        <EditForm
          preorder={p}
          onClose={() => setEditing(false)}
          t={t}
        />
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3 justify-end">
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
            className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5"
          >
            ✎ {t("preorders.edit")}
          </button>
        </div>
      )}

      {historyOpen ? <PreorderHistory id={p.id} t={t} /> : null}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit form — status + store + order_ref + tracking_url + release_date + note

function EditForm({ preorder: p, onClose, t }) {
  const [form, setForm] = useState(() => ({
    status: p.status ?? "preordered",
    store: p.store ?? "",
    order_ref: p.order_ref ?? "",
    tracking_url: p.tracking_url ?? "",
    release_date: p.release_date_current ?? "",
    note: "",
  }));
  const update = useUpdatePreorder();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  // Quick-actions: jump straight to "shipped" or "received" without
  // editing other fields — the two most common state transitions.
  const quickStatus = (next) =>
    update.mutate({
      id: p.id,
      patch: { status: next },
    });

  const onSubmit = async (e) => {
    e.preventDefault();
    const nz = (s) => (typeof s === "string" && s.trim() !== "" ? s.trim() : null);
    const payload = {
      status: form.status,
      store: nz(form.store),
      order_ref: nz(form.order_ref),
      tracking_url: nz(form.tracking_url),
      release_date: form.release_date || null,
      release_date_note: nz(form.note),
    };
    await update.mutateAsync({ id: p.id, patch: payload });
    onClose();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="mt-5 pt-5 border-t border-[var(--color-or)]/20 space-y-5"
    >
      {/* Quick status transitions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="micro-tight mr-2">{t("preorders.quick.title")}</span>
        <QuickStatusBtn
          label={t("status.shipped")}
          active={form.status === "shipped"}
          onClick={() => {
            set("status")("shipped");
            quickStatus("shipped");
          }}
        />
        <QuickStatusBtn
          label={t("status.received")}
          active={form.status === "received"}
          onClick={() => {
            set("status")("received");
            quickStatus("received");
          }}
          tone="gold"
        />
        <QuickStatusBtn
          label={t("status.cancelled")}
          active={form.status === "cancelled"}
          onClick={() => {
            set("status")("cancelled");
            quickStatus("cancelled");
          }}
          tone="laque"
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Select
          label={t("preorders.field.status")}
          value={form.status}
          onChange={set("status")}
          options={STATUS_OPTIONS.map((s) => ({
            value: s,
            label: t(`status.${s}`),
          }))}
        />
        <FormField
          label={t("preorders.field.release_date")}
          type="date"
          value={form.release_date}
          onChange={set("release_date")}
        />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <FormField
          label={t("preorders.field.store")}
          value={form.store}
          onChange={set("store")}
          placeholder={t("preorders.field.store_ph")}
        />
        <FormField
          label={t("preorders.field.order_ref")}
          value={form.order_ref}
          onChange={set("order_ref")}
          placeholder={t("preorders.field.order_ref_ph")}
        />
      </div>

      <div>
        <FormField
          label={t("preorders.field.tracking_url")}
          type="url"
          value={form.tracking_url}
          onChange={set("tracking_url")}
          placeholder={t("preorders.field.tracking_url_ph")}
          hint={t("preorders.field.tracking_url_hint")}
        />
        {form.tracking_url ? (
          <div className="mt-3">
            <TrackingChip url={form.tracking_url} size="compact" />
          </div>
        ) : null}
      </div>

      <FormField
        label={t("preorders.bump_note")}
        value={form.note}
        onChange={set("note")}
        placeholder={t("preorders.bump_note_ph")}
        hint={t("preorders.bump_note_hint")}
      />

      {update.isError ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {update.error?.message}
        </p>
      ) : null}

      <div className="flex justify-end gap-3 pt-2">
        <Button
          variant="ghost"
          type="button"
          onClick={onClose}
          disabled={update.isPending}
        >
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={update.isPending}>
          {t("preorders.save")}
        </Button>
      </div>
    </form>
  );
}

function QuickStatusBtn({ label, active, onClick, tone = "default" }) {
  const toneClass =
    tone === "gold"
      ? active
        ? "bg-[var(--color-or)] text-[var(--color-noir)] border-[var(--color-or)]"
        : "border-[var(--color-or)]/40 text-[var(--color-or)] hover:border-[var(--color-or)] hover:bg-[var(--color-or)]/10"
      : tone === "laque"
        ? active
          ? "bg-[var(--color-laque)] text-[var(--color-ivoire)] border-[var(--color-laque)]"
          : "border-[var(--color-laque-bright)]/40 text-[var(--color-laque-bright)] hover:border-[var(--color-laque-bright)] hover:bg-[var(--color-laque)]/10"
        : active
          ? "bg-[var(--color-or)]/15 text-[var(--color-or)] border-[var(--color-or)]"
          : "border-[var(--color-or)]/30 text-[var(--color-ivoire-soft)] hover:border-[var(--color-or)]/70 hover:text-[var(--color-or-pale)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] border transition-colors ${toneClass}`}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ status, t }) {
  // Tone the pill so the eye can scan lifecycle states at a glance.
  // shipped → gold (en route)   ·   received → solid gold (delivered)
  // cancelled → laque              ·   default → subtle gold
  const tone =
    status === "received"
      ? "bg-[var(--color-or)] text-[var(--color-noir)] border-[var(--color-or)]"
      : status === "shipped"
        ? "border-[var(--color-or)] text-[var(--color-or)]"
        : status === "cancelled"
          ? "border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)]"
          : "border-[var(--color-or)]/40 text-[var(--color-or-pale)]";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-[10px] uppercase tracking-[0.22em] border ${tone}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

function DetailField({ label, value, mono = false }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]">
        {label}
      </dt>
      <dd
        className={`mt-1 text-[var(--color-ivoire)] truncate ${
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
