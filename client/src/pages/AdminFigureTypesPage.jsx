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
import { typeHue } from "../lib/typeHue.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import EmptyStateBlock from "../components/EmptyState.jsx";

/**
 * /admin/figure-types — the catalogue's type taxonomy, redrawn to Direction A
 * ("Shōjo-Noir"). Renders inside AdminLayout's <Outlet/>, so the global
 * "Administration" h1 + sub-nav already sit above it; this view is therefore an
 * editorial *section* of the admin surface (mirrors AdminOverviewPage), not a
 * second page header.
 *
 * This page is naturally on-theme — every type owns a kanji glyph + a signature
 * hue — so the redesign leans into that identity:
 *
 *   - an editorial section header (kicker · 類 · label → AccentTitle h2 →
 *     gold-rule → italic gloss) over a faint kanji-mark 類 watermark;
 *   - a three-up StatCard strip counting the registry (total · coloured ·
 *     in-use) — Types is an allowed figurine metric;
 *   - each type as a refined Card row: a left spine + kanji glyph painted in the
 *     type's own hue, a hue swatch, the slug + bilingual labels + position, the
 *     usage read-out, and inline edit/delete controls;
 *   - the shared bulk-action bar + select checkboxes (laque destructive);
 *   - an inline create form at the top + inline edit forms per row.
 *
 * ALL admin logic is unchanged: the colour picker, kanji edit, position, the
 * create/patch/delete + bulk-delete mutations and the in-use delete guard are
 * the same — only the JSX is restyled/restructured. GPU-light: flat fills,
 * hairlines, the per-type hue mixed into static washes, no meshes / blur /
 * continuous animation. hanko-red primary CTA, laque destructive.
 */
export default function AdminFigureTypesPage() {
  const t = useT();
  const types = useAdminFigureTypes();
  const [adding, setAdding] = useState(false);
  const bulkDel = useBulkDeleteFigureTypes();

  const list = useMemo(() => types.data ?? [], [types.data]);
  const ids = useMemo(() => list.map((ty) => ty.id), [list]);
  const sel = useRowSelection(ids);

  // Registry counters → a quiet StatCard strip. Counts only (no money), so the
  // headline stays gold (catalogue value-of-curation) and the coloured tally
  // marks the types that carry a custom hue.
  const total = list.length;
  const coloured = useMemo(
    () => list.filter((ty) => (ty.accent_color ?? "").trim().length > 0).length,
    [list],
  );

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-10">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] -top-24 -right-6 hidden md:block select-none"
        >
          類
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.figtypes.kicker", { default: "RÉGISTRE" })}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            類
          </span>
          {t("admin.figtypes.kicker_label", { default: "CATÉGORIES" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.types.title")} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl mt-4 reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.types.body")}
        </p>

        {/* Registry counters. */}
        <div
          className="mt-8 grid grid-cols-2 lg:grid-cols-3 gap-3 reveal"
          style={{ "--i": 4 }}
        >
          <StatCard
            label={t("admin.tab.figure_types")}
            value={total}
            sub={t("admin.figtypes.stat.total_sub", { default: "au registre" })}
            tone="gold"
          />
          <StatCard
            label={t("admin.figtypes.stat.coloured", { default: "Teintés" })}
            value={coloured}
            sub={t("admin.figtypes.stat.coloured_sub", { default: "hue personnalisée" })}
          />
          <StatCard
            label={t("admin.figtypes.stat.default", { default: "Par défaut" })}
            value={Math.max(0, total - coloured)}
            sub={t("admin.figtypes.stat.default_sub", { default: "hue du thème" })}
          />
        </div>
      </header>

      {/* ─── Add control ─── */}
      {!adding ? (
        <div className="mb-8 flex items-center justify-between gap-3 reveal" style={{ "--i": 5 }}>
          <p className="micro-tight text-[var(--color-ivoire-soft)]/70">
            {types.data ? t("admin.types.count", { n: total }) : "—"}
          </p>
          <Button variant="primary" onClick={() => setAdding(true)}>
            + {t("admin.types.add")}
          </Button>
        </div>
      ) : null}

      {adding ? <CreateRow t={t} onClose={() => setAdding(false)} /> : null}

      {/* ─── The registry ─── */}
      {types.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : total === 0 ? (
        <EmptyState t={t} onAdd={() => setAdding(true)} />
      ) : (
        <section aria-label={t("admin.types.eyebrow")}>
          <BulkActionBar
            selectedIds={sel.selectedIds}
            onClear={sel.clear}
            onDelete={(idList) => bulkDel.mutateAsync(idList)}
            busy={bulkDel.isPending}
            confirmBody={t("admin.bulk.confirm.body.types", {
              n: sel.selectedIds.length,
            })}
          />

          {/* Select-all rail — mirrors the other admin tables. */}
          <div className="flex items-center gap-3 mb-3 px-1">
            <SelectCheckbox
              checked={sel.allSelected}
              indeterminate={sel.someSelected && !sel.allSelected}
              onChange={sel.toggleAll}
              label={t("admin.bulk.select_all")}
            />
            <span className="label-mono text-[var(--color-ivoire-soft)]/60">
              {t("admin.bulk.select_all")}
            </span>
          </div>

          <ol className="space-y-3">
            {list.map((ty, i) => (
              <li key={ty.id} className="reveal" style={{ "--i": Math.min(i, 8) }}>
                <Row ty={ty} t={t} sel={sel} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row — read mode + inline edit toggle. A refined Card whose left spine + kanji
// glyph + swatch are painted in the type's own signature hue.
// ─────────────────────────────────────────────────────────────────────────────

function Row({ ty, t, sel }) {
  const [editing, setEditing] = useState(false);
  const usage = useFigureTypeUsage(ty.id);
  const inUse = (usage.data?.count ?? 0) > 0;

  if (editing) {
    return <EditRow ty={ty} t={t} onClose={() => setEditing(false)} />;
  }

  const hue = typeHue(ty.id);
  const checked = sel.isSelected(ty.id);

  return (
    <Card
      as="article"
      className={`relative overflow-hidden transition-colors ${
        checked ? "adm-row-selected" : ""
      }`}
    >
      {/* Hue spine — the type's signature colour threads down the left edge. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: hue, opacity: 0.85 }}
      />

      <div className="flex items-center gap-4 md:gap-5 p-4 md:p-5 pl-5 md:pl-6">
        <SelectCheckbox
          checked={checked}
          onChange={() => sel.toggle(ty.id)}
          label={t("admin.bulk.select_row")}
        />

        {/* Kanji glyph tile — painted in the type's own hue over a faint wash. */}
        <span
          aria-hidden
          className="ja shrink-0 grid place-items-center w-14 h-14 md:w-16 md:h-16 text-3xl md:text-4xl leading-none border"
          style={{
            color: hue,
            borderColor: `color-mix(in oklab, ${hue} 35%, transparent)`,
            background: `color-mix(in oklab, ${hue} 9%, transparent)`,
          }}
        >
          {ty.kanji}
        </span>

        {/* Identity — slug + position, bilingual labels, usage. */}
        <div className="min-w-0 flex-1 grid gap-2">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="font-mono text-[0.92rem] tracking-[0.05em] text-[var(--color-or-pale)]">
              {ty.id}
            </span>
            <span className="label-mono text-[var(--color-ivoire-soft)]/50">
              № {ty.position}
            </span>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span className="inline-flex items-baseline gap-2">
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-[color-mix(in_oklab,var(--color-or)_55%,transparent)]">
                FR
              </span>
              <span className="text-[0.95rem] text-[var(--color-ivoire)]">
                {ty.label_fr}
              </span>
            </span>
            <span className="inline-flex items-baseline gap-2">
              <span className="font-mono text-[9px] tracking-[0.22em] uppercase text-[color-mix(in_oklab,var(--color-or)_55%,transparent)]">
                EN
              </span>
              <span className="text-[0.95rem] text-[var(--color-ivoire)]">
                {ty.label_en}
              </span>
            </span>
          </div>

          <div className="font-mono text-[10px] tracking-[0.18em] uppercase">
            {usage.isLoading ? (
              <span className="opacity-60">…</span>
            ) : inUse ? (
              <span className="text-[var(--color-or-pale)]">
                {t("admin.types.usage_used", { n: usage.data.count })}
              </span>
            ) : (
              <span className="text-[color-mix(in_oklab,var(--color-ivoire)_40%,transparent)]">
                {t("admin.types.usage_empty")}
              </span>
            )}
          </div>
        </div>

        {/* Hue swatch — the signature colour, read-only here. */}
        <span
          aria-hidden
          title={ty.accent_color ?? t("admin.figtypes.swatch.default", { default: "Défaut du thème" })}
          className="hidden sm:inline-block shrink-0 w-7 h-7 border"
          style={{
            background: hue,
            borderColor: "color-mix(in oklab, var(--color-or) 30%, transparent)",
          }}
        />

        {/* Inline actions. */}
        <div className="flex items-start gap-1.5 shrink-0">
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
      </div>
    </Card>
  );
}

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
      className="ftype-form ftype-form--create mb-8"
      aria-label={t("admin.types.add")}
    >
      <p className="ftype-form-eyebrow flex items-center gap-2">
        <span aria-hidden className="ja not-italic text-base text-[var(--color-or)] leading-none">
          類
        </span>
        + {t("admin.types.add")}
      </p>
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
    <EmptyStateBlock
      kanji="類"
      eyebrow={t("admin.figtypes.kicker_label", { default: "CATÉGORIES" })}
      title={t("admin.types.empty")}
      body={t("admin.types.body")}
    >
      <Button variant="primary" onClick={onAdd}>
        + {t("admin.types.add")}
      </Button>
    </EmptyStateBlock>
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
