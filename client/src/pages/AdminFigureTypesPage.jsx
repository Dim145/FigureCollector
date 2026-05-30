import { useEffect, useId, useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminFigureTypes,
  useBulkDeleteFigureTypes,
  useCreateFigureType,
  useDeleteFigureType,
  useFigureTypeUsage,
  usePatchFigureType,
} from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import Button from "../components/Button.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import EmptyStateBlock from "../components/EmptyState.jsx";

/**
 * Admin curates the figure-type dropdown.
 *
 * Visual direction: "register of categories" — a vertical ledger of rows,
 * each row a horizontal strip whose far-left column is the kanji at large
 * size, then slug + bilingual labels + position, then inline actions.
 *
 * The aesthetic mirrors the Horarium (preorders page) — a single gold
 * spine threads down the left, each row stamped with its kanji glyph
 * like a category seal in the margin.
 *
 * The "add" form sits at the top of the list, inline (no separate
 * dialog) because adding a type is the user's reason for being on this
 * page. Existing rows toggle into an inline edit form on the ✎ button.
 */
export default function AdminFigureTypesPage() {
  const t = useT();
  const types = useAdminFigureTypes();
  const [adding, setAdding] = useState(false);
  const bulkDel = useBulkDeleteFigureTypes();

  const ids = useMemo(() => (types.data ?? []).map((ty) => ty.id), [types.data]);
  const sel = useRowSelection(ids);

  return (
    <section className="space-y-8">
      {/* ─── Hero ─── */}
      <header className="relative">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-2 text-[10rem] leading-none text-[var(--color-or)]/[0.06] select-none pointer-events-none hidden md:block"
        >
          類
        </span>
        <p className="micro">{t("admin.types.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-2">
          {t("admin.types.title")}
        </h2>
        <div className="gold-rule w-16 mt-4" />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.types.body")}
        </p>

        <div className="mt-7 flex items-center gap-3 justify-between">
          <p className="micro-tight">
            {types.data
              ? t("admin.types.count", { n: types.data.length })
              : "—"}
          </p>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors border border-[var(--color-or)]/40 hover:border-[var(--color-or)] px-3 py-1.5"
            >
              + {t("admin.types.add")}
            </button>
          ) : null}
        </div>
      </header>

      {/* ─── Inline create ─── */}
      {adding ? <CreateRow t={t} onClose={() => setAdding(false)} /> : null}

      {/* ─── Ledger ─── */}
      {types.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
      ) : types.data?.length === 0 ? (
        <EmptyState t={t} onAdd={() => setAdding(true)} />
      ) : (
        <ol className="relative ml-3 border-l border-[var(--color-or)]/25">
          {types.data?.map((ty) => (
            <li key={ty.id} className="relative pl-8 pb-5 last:pb-0">
              <Row ty={ty} t={t} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — read mode + inline edit toggle
// ─────────────────────────────────────────────────────────────────────────────

function Row({ ty, t }) {
  const [editing, setEditing] = useState(false);
  const usage = useFigureTypeUsage(ty.id);
  const inUse = (usage.data?.count ?? 0) > 0;

  if (editing) {
    return <EditRow ty={ty} t={t} onClose={() => setEditing(false)} />;
  }

  return (
    <article className="ftype-row">
      {/* Kanji seal hangs in the gutter — overlaps the gold spine. */}
      <span aria-hidden className="ftype-row-seal">
        {ty.kanji}
      </span>

      <div className="ftype-row-body">
        <div className="ftype-row-headline">
          <span className="ftype-row-slug">{ty.id}</span>
          <span className="ftype-row-position">№ {ty.position}</span>
        </div>

        <div className="ftype-row-labels">
          <span>
            <span className="ftype-row-locale">FR</span>
            <span className="ftype-row-label">{ty.label_fr}</span>
          </span>
          <span>
            <span className="ftype-row-locale">EN</span>
            <span className="ftype-row-label">{ty.label_en}</span>
          </span>
        </div>

        <div className="ftype-row-meta">
          {usage.isLoading ? (
            <span className="opacity-60">…</span>
          ) : inUse ? (
            <span className="ftype-row-usage">
              {t("admin.types.usage_used", { n: usage.data.count })}
            </span>
          ) : (
            <span className="ftype-row-usage is-empty">
              {t("admin.types.usage_empty")}
            </span>
          )}
        </div>
      </div>

      <div className="ftype-row-actions">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ftype-row-btn"
          title={t("admin.types.edit")}
        >
          ✎ <span className="sr-only">{t("admin.types.edit")}</span>
        </button>
        <DeleteButton ty={ty} t={t} inUse={inUse} usageCount={usage.data?.count ?? 0} />
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline create form
// ─────────────────────────────────────────────────────────────────────────────

function CreateRow({ t, onClose }) {
  const [form, setForm] = useState({
    id: "",
    label_fr: "",
    label_en: "",
    kanji: "",
    position: 100,
    accent_color: "",
  });
  const create = useCreateFigureType();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    await create.mutateAsync({
      id: form.id.trim(),
      label_fr: form.label_fr.trim(),
      label_en: form.label_en.trim(),
      kanji: form.kanji.trim(),
      position: Number(form.position) || 100,
      accent_color: form.accent_color.trim() || null,
    });
    onClose();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="ftype-form ftype-form--create"
      aria-label={t("admin.types.add")}
    >
      <p className="ftype-form-eyebrow">+ {t("admin.types.add")}</p>
      <div className="ftype-form-grid">
        <Field
          label={t("admin.types.field.slug")}
          hint={t("admin.types.field.slug_hint")}
          value={form.id}
          onChange={set("id")}
          mono
          autoFocus
        />
        <Field
          label={t("admin.types.field.kanji")}
          hint={t("admin.types.field.kanji_hint")}
          value={form.kanji}
          onChange={set("kanji")}
          ja
          short
        />
        <Field
          label={t("admin.types.field.position")}
          hint={t("admin.types.field.position_hint")}
          value={String(form.position)}
          onChange={(v) => set("position")(v.replace(/[^0-9]/g, ""))}
          mono
          short
        />
        <Field
          label={t("admin.types.field.label_fr")}
          value={form.label_fr}
          onChange={set("label_fr")}
        />
        <Field
          label={t("admin.types.field.label_en")}
          value={form.label_en}
          onChange={set("label_en")}
        />
        <ColorField
          ty={{ id: form.id }}
          value={form.accent_color}
          onChange={set("accent_color")}
          t={t}
        />
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
          {t("admin.types.confirm_add")}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline edit form (existing row)
// ─────────────────────────────────────────────────────────────────────────────

function EditRow({ ty, t, onClose }) {
  const [form, setForm] = useState({
    label_fr: ty.label_fr,
    label_en: ty.label_en,
    kanji: ty.kanji,
    position: ty.position,
    accent_color: ty.accent_color ?? "",
  });
  const patch = usePatchFigureType();
  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    setForm({
      label_fr: ty.label_fr,
      label_en: ty.label_en,
      kanji: ty.kanji,
      position: ty.position,
      accent_color: ty.accent_color ?? "",
    });
  }, [ty.id, ty.updated_at, ty.label_fr, ty.label_en, ty.kanji, ty.position, ty.accent_color]);

  const onSubmit = async (e) => {
    e.preventDefault();
    await patch.mutateAsync({
      id: ty.id,
      patch: {
        label_fr: form.label_fr.trim(),
        label_en: form.label_en.trim(),
        kanji: form.kanji.trim(),
        position: Number(form.position) || 100,
        accent_color: form.accent_color.trim() || null,
      },
    });
    onClose();
  };

  return (
    <form
      onSubmit={onSubmit}
      className="ftype-form ftype-form--edit"
      aria-label={t("admin.types.edit")}
    >
      <p className="ftype-form-eyebrow">
        ✎ <span className="font-mono normal-case">{ty.id}</span>
      </p>
      <div className="ftype-form-grid">
        <Field
          label={t("admin.types.field.kanji")}
          value={form.kanji}
          onChange={set("kanji")}
          ja
          short
        />
        <Field
          label={t("admin.types.field.position")}
          value={String(form.position)}
          onChange={(v) => set("position")(v.replace(/[^0-9]/g, ""))}
          mono
          short
        />
        <Field
          label={t("admin.types.field.label_fr")}
          value={form.label_fr}
          onChange={set("label_fr")}
        />
        <Field
          label={t("admin.types.field.label_en")}
          value={form.label_en}
          onChange={set("label_en")}
        />
        <ColorField
          ty={ty}
          value={form.accent_color}
          onChange={set("accent_color")}
          t={t}
        />
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
          {t("admin.types.confirm_edit")}
        </Button>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete button — disabled with a tooltip when in-use, confirms otherwise
// ─────────────────────────────────────────────────────────────────────────────

function DeleteButton({ ty, t, inUse, usageCount }) {
  const del = useDeleteFigureType();
  const [confirming, setConfirming] = useState(false);

  if (inUse) {
    return (
      <button
        type="button"
        disabled
        title={t("admin.types.delete_blocked", { n: usageCount })}
        className="ftype-row-btn is-disabled"
      >
        × <span className="sr-only">{t("admin.types.delete")}</span>
      </button>
    );
  }

  if (confirming) {
    return (
      <span className="ftype-confirm">
        <button
          type="button"
          onClick={async () => {
            await del.mutateAsync(ty.id);
          }}
          disabled={del.isPending}
          className="ftype-confirm-yes"
        >
          {t("admin.types.delete_yes")}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={del.isPending}
          className="ftype-confirm-no"
        >
          {t("admin.types.delete_no")}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title={t("admin.types.delete")}
      className="ftype-row-btn ftype-row-btn--danger"
    >
      × <span className="sr-only">{t("admin.types.delete")}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + Field
// ─────────────────────────────────────────────────────────────────────────────

// Accent-colour control: a *single* swatch that doubles as the native colour
// picker. The swatch paints the effective colour — the custom value, or the
// pristine theme default `--type-<id>` when none is set (the admin override
// lives in the separate `--type-accent-<id>`, so the base var is never shadowed
// and reset/empty previews the real default) — with a transparent
// <input type=color> on top, so the swatch you see is the selector you click.
// Beside it: a free CSS-colour text field (oklch / rgb / name) and a reset that
// clears back to null.
function ColorField({ ty, value, onChange, t }) {
  const id = ty.id || "";
  const v = (value ?? "").trim();
  const hasCustom = v.length > 0;
  const effective = hasCustom ? v : `var(--type-${id}, var(--color-or))`;
  // Pristine default hue, read from the (never-overridden) base var — used to
  // seed the picker dialog when there's no custom value yet.
  const pristineDefault =
    typeof document !== "undefined" && id
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(`--type-${id}`)
          .trim()
      : "";
  // The native picker only accepts #rrggbb: feed it the custom colour (resolved
  // from hex / oklch / name) when set, else the resolved pristine default — so
  // the OS dialog always opens on the colour the swatch is showing.
  const pickerValue = colorToHex(hasCustom ? v : pristineDefault);
  return (
    <label className="block col-span-full">
      <span className="ftype-field-label">{t("admin.types.field.color")}</span>
      <span className="flex items-center gap-2 mt-1">
        <span className="relative w-9 h-9 shrink-0 inline-block">
          <span
            aria-hidden
            style={{ background: effective }}
            className="absolute inset-0 border border-[var(--color-or)]/30"
          />
          <input
            type="color"
            aria-label={t("admin.types.field.color_pick")}
            value={pickerValue}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </span>
        <input
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("admin.types.field.color_ph")}
          className="ftype-field-input font-mono flex-1"
        />
        {hasCustom ? (
          <button
            type="button"
            onClick={() => onChange("")}
            title={t("admin.types.field.color_reset")}
            className="shrink-0 tap-target px-2 text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors"
          >
            ↺<span className="sr-only">{t("admin.types.field.color_reset")}</span>
          </button>
        ) : null}
      </span>
      <span className="ftype-field-hint">{t("admin.types.field.color_hint")}</span>
    </label>
  );
}

// Resolve any CSS colour string (hex, oklch, lab, named…) to a #rrggbb so the
// native <input type=color> can seed its dialog — it only accepts hex. A hex
// passes straight through; anything else is painted onto a 1px canvas and read
// back as rasterised sRGB bytes (the picker can't parse oklch directly). Falls
// back to antique gold when empty or unresolvable.
function colorToHex(input) {
  const fallback = "#c8a24b";
  const s = (input ?? "").toString().trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (!s || typeof document === "undefined") return fallback;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillStyle = s;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return fallback;
  }
}

function EmptyState({ t, onAdd }) {
  return (
    <div className="text-center py-16">
      <p className="ja text-[6rem] text-[var(--color-or)]/30 leading-none">類</p>
      <p className="mt-3 text-[var(--color-ivoire-soft)] italic">
        {t("admin.types.empty")}
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-5 px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
      >
        + {t("admin.types.add")}
      </button>
    </div>
  );
}

function Field({ label, hint, value, onChange, mono, ja, short, autoFocus }) {
  // `useId` is React's stable, SSR-safe replacement for Math.random for
  // generating unique-but-deterministic input ids. The label is only used
  // for the visible text, not for the id, so duplicates of the same label
  // across rows still pair their input <-> <label> correctly.
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={`block ${short ? "ftype-field--short" : ""}`}
    >
      <span className="ftype-field-label">{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className={`ftype-field-input ${mono ? "font-mono" : ""} ${ja ? "ja text-xl text-center" : ""}`}
      />
      {hint ? <span className="ftype-field-hint">{hint}</span> : null}
    </label>
  );
}
