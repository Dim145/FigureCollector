import { useRef, useState } from "react";
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
import Button from "../components/Button.jsx";
import FormField from "../components/FormField.jsx";

/**
 * Admin curates the stores registry — same registry vibe as the
 * figure-types page, but each row also has a profile image thumbnail
 * and a longer description field.
 *
 * Read mode: thumbnail + name + slug + URL host + usage count.
 * Inline edit: name + url + description; admins can also upload the
 *              profile image from there.
 */
export default function AdminStoresPage() {
  const t = useT();
  const stores = useAdminStores();
  const [adding, setAdding] = useState(false);

  return (
    <section className="space-y-8">
      <header className="relative">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-2 text-[10rem] leading-none text-[var(--color-or)]/[0.06] select-none pointer-events-none hidden md:block"
        >
          店
        </span>
        <p className="micro">{t("admin.stores.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-2">
          {t("admin.stores.title")}
        </h2>
        <div className="gold-rule w-16 mt-4" />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.stores.body")}
        </p>

        <div className="mt-7 flex items-center gap-3 justify-between">
          <p className="micro-tight">
            {stores.data
              ? t("admin.stores.count", { n: stores.data.length })
              : "—"}
          </p>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5"
            >
              + {t("admin.stores.add")}
            </button>
          ) : null}
        </div>
      </header>

      {adding ? <CreateRow t={t} onClose={() => setAdding(false)} /> : null}

      {stores.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
      ) : stores.data?.length === 0 ? (
        <div className="text-center py-16">
          <p className="ja text-[6rem] text-[var(--color-or)]/30 leading-none">店</p>
          <p className="mt-3 text-[var(--color-ivoire-soft)] italic">
            {t("admin.stores.empty")}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {stores.data?.map((s) => (
            <li key={s.id}>
              <Row store={s} t={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — read mode with thumbnail + inline edit toggle
// ─────────────────────────────────────────────────────────────────────────────

function Row({ store, t }) {
  const [editing, setEditing] = useState(false);
  const usage = useStoreUsage(store.id);
  const total = (usage.data?.owned_items ?? 0) + (usage.data?.preorders ?? 0);

  if (editing) {
    return <EditRow store={store} t={t} onClose={() => setEditing(false)} />;
  }

  return (
    <article className="store-admin-row">
      <div className="store-admin-thumb">
        {store.image_storage_key ? (
          <img
            src={`/api/store-image/${store.id}`}
            alt=""
            aria-hidden
          />
        ) : (
          <div aria-hidden className="store-admin-thumb-placeholder">
            店
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-3">
          <Link
            to={`/stores/${store.slug}`}
            className="display text-lg text-[var(--color-ivoire)] hover:text-[var(--color-or-pale)] transition-colors underline decoration-[var(--color-or)]/30 hover:decoration-[var(--color-or)] underline-offset-4"
          >
            {store.name}
          </Link>
          <span className="font-mono text-[10px] tracking-[0.22em] uppercase text-[var(--color-or-pale)]/55">
            /{store.slug}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono uppercase tracking-[0.18em]">
          {store.url ? (
            <a
              href={store.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-or-pale)] hover:text-[var(--color-or)]"
            >
              ↗ {prettyHost(store.url)}
            </a>
          ) : (
            <span className="text-[var(--color-ivoire-soft)]/35">
              {t("admin.stores.no_url")}
            </span>
          )}
          <span
            className={total > 0 ? "text-[var(--color-or-pale)]" : "text-[var(--color-ivoire-soft)]/35"}
          >
            {total > 0
              ? t("admin.stores.usage", {
                  owned: usage.data.owned_items,
                  pre: usage.data.preorders,
                })
              : t("admin.stores.usage_empty")}
          </span>
        </div>
      </div>

      <div className="flex gap-2">
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
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit forms
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
    <form onSubmit={onSubmit} className="ftype-form ftype-form--create">
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
    <form onSubmit={onSubmit} className="ftype-form ftype-form--edit">
      <p className="ftype-form-eyebrow">
        ✎ <span className="font-mono normal-case">/{store.slug}</span>
      </p>
      <div className="grid sm:grid-cols-[100px_1fr] gap-4 items-start">
        {/* Photo column */}
        <div>
          <span className="ftype-field-label">{t("admin.stores.field.image")}</span>
          <div className="store-admin-thumb">
            {store.image_storage_key ? (
              <img
                src={`/api/store-image/${store.id}`}
                alt=""
                aria-hidden
              />
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
