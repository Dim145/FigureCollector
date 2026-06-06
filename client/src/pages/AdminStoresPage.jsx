import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import {
  useAdminStores,
  useCreateStore,
  useDeleteStore,
  usePatchStore,
  useStoreUsage,
  useUploadStorePhoto,
} from "../hooks/useStores.js";
import { useBulkDeleteStores } from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import FormField from "../components/FormField.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { safeHref } from "../lib/safeUrl.js";

/**
 * /admin/stores — the stores registry, redrawn to Direction A ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * sub-nav already sit above. This view is therefore an editorial *section* of
 * the admin surface, not a second page header:
 *
 *   - an editorial section header (kicker · 店 · label → AccentTitle h2 →
 *     gold-rule → italic gloss) over a faint kanji-mark watermark;
 *   - a single StatCard for the registry count (gold — the headline figure),
 *     with the inline "+ add" affordance beside it;
 *   - the stores themselves as a Direction-A table: a label-mono column head on
 *     sm+ then one Card per row — logo chip + name/slug + URL-link template +
 *     usage + inline ✎/× actions. The bulk-select column + toolbar are kept.
 *
 * Each store's editable `url` is its storefront / buy-link template (the base
 * the per-figure buy links hang off; those per-figure links live in the figure
 * form). Hanko-red drives the primary CTAs; laque-red the destructive ones.
 *
 * Data + behaviour are UNCHANGED: the same `useAdminStores` list, per-row
 * `useStoreUsage`, create/patch/delete/upload mutations, bulk-delete and
 * row-selection hooks drive everything. GPU-light throughout — flat fills,
 * hairlines, the shared `.reveal` stagger, no meshes / blur / continuous
 * animation.
 */
export default function AdminStoresPage() {
  const t = useT();
  const stores = useAdminStores();
  const [adding, setAdding] = useState(false);
  const ids = useMemo(() => (stores.data ?? []).map((s) => s.id), [stores.data]);
  const sel = useRowSelection(ids);
  const bulkDel = useBulkDeleteStores();

  const count = stores.data?.length ?? 0;

  return (
    <section className="relative space-y-10">
      {/* ─── Editorial section header ─── */}
      <header className="relative">
        <span
          aria-hidden
          className="kanji-mark text-[16rem] -top-20 -right-4 hidden md:block select-none"
        >
          店
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.stores.eyebrow")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            店
          </span>
          {t("admin.stores.kicker_label", { default: "BOUTIQUES" })}
        </p>
        <h2
          className="display text-3xl md:text-4xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.stores.title")} />
        </h2>
        <div className="gold-rule w-16 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="display-italic text-[var(--color-or)] text-base md:text-lg mt-4 max-w-2xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.stores.body")}
        </p>
      </header>

      {/* ─── Registry count + inline add ─── */}
      <div
        className="reveal flex flex-wrap items-stretch justify-between gap-4"
        style={{ "--i": 4 }}
      >
        <div className="w-44 max-w-full">
          <StatCard
            label={t("admin.stores.stat.label", { default: "Registre" })}
            value={count}
            sub={t("admin.stores.stat.sub", { default: "boutiques enregistrées" })}
            tone="gold"
          />
        </div>
        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="tap-target self-center text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-4 py-2.5"
          >
            + {t("admin.stores.add")}
          </button>
        ) : null}
      </div>

      {adding ? <CreateRow t={t} onClose={() => setAdding(false)} /> : null}

      {stores.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : count === 0 ? (
        <EmptyState
          compact
          kanji="店"
          title={t("admin.empty.stores.title")}
          body={t("admin.empty.stores.body")}
        >
          <Button variant="primary" onClick={() => setAdding(true)}>
            + {t("admin.stores.add")}
          </Button>
        </EmptyState>
      ) : (
        <div className="reveal space-y-3" style={{ "--i": 5 }}>
          {/* Select-all + column head — the table's masthead. The label-mono
              column titles only show on sm+ where the row grid lines up under
              them; on mobile each Card stacks and carries its own context. */}
          <div className="flex items-center gap-3 px-1">
            <SelectCheckbox
              checked={sel.allSelected}
              indeterminate={sel.someSelected && !sel.allSelected}
              onChange={sel.toggleAll}
              label={t("admin.bulk.select_all")}
            />
            <span className="micro-tight">{t("admin.bulk.select_all")}</span>
          </div>

          {/* Column head — only on sm+, where the row grid lines up under it.
              The flex gutter + Card-padding spacer mirror each row's
              checkbox column + Card padding so the labels sit over their
              columns. On mobile each Card stacks and carries its own context. */}
          <div className="hidden sm:flex gap-3" aria-hidden>
            <span className="shrink-0 w-[18px]" />
            <div className="flex-1 grid grid-cols-[64px_1.6fr_1.4fr_auto] gap-x-4 items-center px-4 pb-1 border-b border-[var(--color-or)]/15">
              <span className="label-mono text-[var(--color-ivoire-soft)]/55">
                店
              </span>
              <span className="label-mono text-[var(--color-ivoire-soft)]/55">
                {t("admin.stores.col.store", { default: "Boutique" })}
              </span>
              <span className="label-mono text-[var(--color-ivoire-soft)]/55">
                {t("admin.stores.col.link", { default: "Lien · usage" })}
              </span>
              <span className="label-mono text-[var(--color-ivoire-soft)]/55 text-right">
                {t("admin.stores.col.actions", { default: "Actions" })}
              </span>
            </div>
          </div>

          <BulkActionBar
            selectedIds={sel.selectedIds}
            onClear={sel.clear}
            onDelete={(idList) => bulkDel.mutateAsync(idList)}
            busy={bulkDel.isPending}
            confirmBody={t("admin.bulk.confirm.body.stores", {
              n: sel.selectedIds.length,
            })}
          />

          <ul className="space-y-3">
            {stores.data?.map((s) => (
              <li key={s.id} className="flex items-stretch gap-3">
                <div className="pt-5 shrink-0">
                  <SelectCheckbox
                    checked={sel.isSelected(s.id)}
                    onChange={() => sel.toggle(s.id)}
                    label={t("admin.bulk.select_row")}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <Row store={s} t={t} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quiet ukiyo-e wave veil closing the section — static gradient, ~0 GPU. */}
      <div
        aria-hidden
        className="seigaiha mt-14 h-14 opacity-50"
        style={{
          maskImage: "linear-gradient(#000, transparent)",
          WebkitMaskImage: "linear-gradient(#000, transparent)",
        }}
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — A table row in a Card: logo chip + name/slug + URL-template link + usage
// + inline ✎/× actions. Toggles into the inline edit form on ✎.
// ─────────────────────────────────────────────────────────────────────────────

function Row({ store, t }) {
  const [editing, setEditing] = useState(false);
  const usage = useStoreUsage(store.id);
  const total = (usage.data?.owned_items ?? 0) + (usage.data?.preorders ?? 0);

  if (editing) {
    return <EditRow store={store} t={t} onClose={() => setEditing(false)} />;
  }

  const href = safeHref(store.url);

  return (
    <Card className="p-3.5 sm:p-4">
      <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[64px_1.6fr_1.4fr_auto] gap-x-4 gap-y-3 items-center">
        {/* Logo chip — the store's profile image, or a 店 seal placeholder. */}
        <div className="store-admin-thumb">
          {store.image_storage_key ? (
            <img src={`/api/store-image/${store.id}`} alt="" aria-hidden />
          ) : (
            <div aria-hidden className="store-admin-thumb-placeholder">
              店
            </div>
          )}
        </div>

        {/* Name + slug */}
        <div className="min-w-0">
          <Link
            to={`/stores/${store.slug}`}
            className="display text-lg text-[var(--color-ivoire)] hover:text-[var(--color-or-pale)] transition-colors underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
          >
            {store.name}
          </Link>
          <span className="block mt-0.5 font-mono text-[10px] tracking-[0.22em] uppercase text-[var(--color-or-pale)]/55">
            /{store.slug}
          </span>
        </div>

        {/* URL-link template + usage. Spans the full width below name on
            mobile; its own column on sm+. */}
        <div className="col-span-2 sm:col-span-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[10px] font-mono uppercase tracking-[0.18em]">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] truncate max-w-full"
              title={store.url}
            >
              ↗ {prettyHost(store.url)}
            </a>
          ) : (
            <span className="text-[var(--color-ivoire-soft)]/35">
              {t("admin.stores.no_url")}
            </span>
          )}
          <span
            className={
              total > 0
                ? "text-[var(--color-or-pale)]"
                : "text-[var(--color-ivoire-soft)]/35"
            }
          >
            {total > 0
              ? t("admin.stores.usage", {
                  owned: usage.data.owned_items,
                  pre: usage.data.preorders,
                })
              : t("admin.stores.usage_empty")}
          </span>
        </div>

        {/* Actions — edit (gold) + delete (laque). */}
        <div className="col-span-2 sm:col-span-1 flex gap-2 sm:justify-end">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ftype-row-btn"
            title={t("admin.stores.edit")}
          >
            ✎ <span className="sr-only">{t("admin.stores.edit")}</span>
          </button>
          <DeleteButton store={store} t={t} />
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit forms — unchanged logic, Direction-A ftype-form shell.
// ─────────────────────────────────────────────────────────────────────────────

function CreateRow({ t, onClose }) {
  const [form, setForm] = useState({ name: "", url: "", description: "" });
  const create = useCreateStore();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    await create.mutateAsync({
      name: form.name.trim(),
      url: form.url.trim() || null,
      description: form.description.trim() || null,
    });
    onClose();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="ftype-form ftype-form--create reveal"
      aria-label={t("admin.stores.add")}
    >
      <p className="ftype-form-eyebrow">+ {t("admin.stores.add")}</p>
      <div className="space-y-4">
        <FormField
          label={t("admin.stores.field.name")}
          value={form.name}
          onChange={set("name")}
          placeholder={t("admin.stores.field.name_ph")}
          autoFocus
        />
        <FormField
          label={t("admin.stores.field.url")}
          type="url"
          value={form.url}
          onChange={set("url")}
          placeholder="https://amiami.com"
        />
        <label className="block">
          <span className="ftype-field-label">
            {t("admin.stores.field.description")}
          </span>
          <textarea
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            rows={3}
            className="ftype-field-input font-sans"
          />
        </label>
      </div>
      {create.isError ? (
        <p
          role="alert"
          className="mt-3 text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {create.error?.message}
        </p>
      ) : null}
      <div className="ftype-form-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={create.isPending}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={create.isPending}>
          {t("admin.stores.confirm_add")}
        </Button>
      </div>
    </form>
  );
}

function EditRow({ store, t, onClose }) {
  const [form, setForm] = useState({
    name: store.name,
    url: store.url ?? "",
    description: store.description ?? "",
  });
  const patch = usePatchStore();
  const upload = useUploadStorePhoto();
  const fileInput = useRef(null);
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    await patch.mutateAsync({
      id: store.id,
      patch: {
        name: form.name.trim() || null,
        url: form.url.trim() || null,
        description: form.description.trim() || null,
      },
    });
    onClose();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await upload.mutateAsync({ id: store.id, file });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="ftype-form ftype-form--edit"
      aria-label={t("admin.stores.edit")}
    >
      <p className="ftype-form-eyebrow">
        ✎ <span className="font-mono normal-case">/{store.slug}</span>
      </p>
      <div className="grid sm:grid-cols-[100px_1fr] gap-4 items-start">
        <div>
          <span className="ftype-field-label">{t("admin.stores.field.image")}</span>
          <div className="store-admin-thumb">
            {store.image_storage_key ? (
              <img src={`/api/store-image/${store.id}`} alt="" aria-hidden />
            ) : (
              <div aria-hidden className="store-admin-thumb-placeholder">店</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-2 py-1 disabled:opacity-50"
          >
            {upload.isPending ? "…" : t("admin.stores.upload_image")}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFile}
            className="hidden"
          />
        </div>

        <div className="space-y-4">
          <FormField
            label={t("admin.stores.field.name")}
            value={form.name}
            onChange={set("name")}
          />
          <FormField
            label={t("admin.stores.field.url")}
            type="url"
            value={form.url}
            onChange={set("url")}
            placeholder="https://amiami.com"
          />
          <label className="block">
            <span className="ftype-field-label">
              {t("admin.stores.field.description")}
            </span>
            <textarea
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              rows={4}
              className="ftype-field-input font-sans"
            />
          </label>
        </div>
      </div>
      {patch.isError ? (
        <p
          role="alert"
          className="mt-3 text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {patch.error?.message}
        </p>
      ) : null}
      <div className="ftype-form-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={patch.isPending}>
          {t("editor.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={patch.isPending}>
          {t("admin.stores.confirm_edit")}
        </Button>
      </div>
    </form>
  );
}

function DeleteButton({ store, t }) {
  const del = useDeleteStore();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="ftype-confirm">
        <button
          type="button"
          onClick={async () => del.mutateAsync(store.id)}
          disabled={del.isPending}
          className="ftype-confirm-yes"
        >
          {t("admin.stores.delete_yes")}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={del.isPending}
          className="ftype-confirm-no"
        >
          {t("admin.stores.delete_no")}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title={t("admin.stores.delete")}
      className="ftype-row-btn ftype-row-btn--danger"
    >
      × <span className="sr-only">{t("admin.stores.delete")}</span>
    </button>
  );
}

function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
