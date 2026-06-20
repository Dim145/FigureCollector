import { useEffect, useMemo, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useI18n, useT } from "../i18n/index.jsx";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useDefaultCurrency } from "../hooks/useMe.js";
import { useCurrencies } from "../hooks/useCurrencies.js";
import {
  useCharactersLookup,
  useManufacturersLookup,
  useMaterialsLookup,
  useSculptorsLookup,
  useSeriesLookup,
} from "../hooks/useEntities.js";
import { useIsAdmin } from "../hooks/useMe.js";
import { nsfwTags } from "../lib/tags.js";
import AniListLookup from "./AniListLookup.jsx";
import AniListCharacterLookup from "./AniListCharacterLookup.jsx";
import { Button, FormField, Select, Textarea, Checkbox } from "./ui/index.js";
import EntityAutocomplete from "./EntityAutocomplete.jsx";
import FigureLookup from "./FigureLookup.jsx";
import FigureStoresEditor from "./FigureStoresEditor.jsx";
import DuplicateWarning from "./figure-form/DuplicateWarning.jsx";
import TagsEditor from "./figure-form/TagsEditor.jsx";

// Hard-coded fallback list — used only when /figure-types hasn't responded
// yet (page first-paint, offline). The live dropdown is driven from the
// admin-curated registry so custom types added at /admin/figure-types
// surface here automatically.
const TYPE_OPTIONS_FALLBACK = [
  "nendoroid",
  "scale",
  "figma",
  "prize",
  "trading",
  "statue",
  "plamo",
  "bishoujo",
  "dakimakura",
  "other",
];

/**
 * Shared form for both creating (AddFigurePage) and editing (FigureEditDialog)
 * a catalog figure. Same primitives, same input types, same AniList lookup.
 *
 * Sections are visually grouped (Identity / Series / Typology / Production /
 * Catalogue / Flags) so the form reads like an exhibition object label rather
 * than a single field dump. The external lookup (orzgk / proxy / MFC / barcode)
 * is reached through the prominent <FigureLookup> entry under the name field,
 * which opens it in a modal; AniList series/character enrichers stay inline next
 * to their fields. Manual entry of every field is always possible.
 *
 * Public API is unchanged (AddFigurePage + FigureEditDialog depend on it):
 * @param {object} props
 * @param {"create"|"edit"} props.mode
 * @param {object} [props.initial]    Starting values (from existing figure or empty).
 * @param {(payload: object) => Promise<void>} props.onSubmit
 * @param {() => void} [props.onCancel]
 * @param {boolean} [props.busy]
 * @param {string} [props.errorMessage]
 * @param {React.ReactNode} [props.extras]      Render slot below the form.
 * @param {React.ReactNode} [props.footerExtras] Extra footer buttons.
 */
export default function FigureForm({
  mode = "create",
  initial,
  onSubmit,
  onCancel,
  busy = false,
  errorMessage = null,
  extras = null,
  footerExtras = null,
}) {
  const t = useT();
  const { locale } = useI18n();
  const defaultCurrency = useDefaultCurrency();
  const currencyOptions = useCurrencies();
  const isAdmin = useIsAdmin();
  // Live list of figure types (admin-curated). Falls back to the hard-coded
  // list during the first paint so the dropdown isn't ever empty.
  const figureTypes = useFigureTypes();
  const typeOptions = useMemo(() => {
    const rows = figureTypes.data;
    if (Array.isArray(rows) && rows.length > 0) {
      return rows.map((ft) => ({
        value: ft.id,
        label: (locale === "fr" ? ft.label_fr : ft.label_en) || ft.id,
      }));
    }
    return TYPE_OPTIONS_FALLBACK.map((v) => ({ value: v, label: t(`type.${v}`) }));
  }, [figureTypes.data, locale, t]);
  // Autocomplete sources — cached 5 min, prefetched eagerly so the dropdown
  // is responsive on the first keystroke.
  const seriesLookup = useSeriesLookup();
  const charactersLookup = useCharactersLookup();
  const manufacturersLookup = useManufacturersLookup();
  const sculptorsLookup = useSculptorsLookup();
  const materialsLookup = useMaterialsLookup();

  const [form, setForm] = useState(() => normalise(initial, defaultCurrency));
  // If the caller swaps `initial` (Edit modal jumping to a new figure), we
  // re-seed the local state — guarded by the figure id so a parent re-render
  // with the same object doesn't blow away in-progress edits.
  useEffect(() => {
    setForm(normalise(initial, defaultCurrency));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id]);

  // `useDefaultCurrency()` starts as JPY (fallback) until /api/me resolves.
  // Track the last-applied default in a ref: while the field still holds that
  // exact value we treat it as untouched and swap to the new default; once the
  // user picks anything else (or we're editing), the swap stops.
  const lastAppliedDefaultRef = useRef(defaultCurrency);
  useEffect(() => {
    if (!defaultCurrency) return;
    if (initial?.msrp_currency) return; // edit mode — never override
    setForm((s) => {
      if (s.msrp_currency === lastAppliedDefaultRef.current) {
        lastAppliedDefaultRef.current = defaultCurrency;
        if (s.msrp_currency === defaultCurrency) return s;
        return { ...s, msrp_currency: defaultCurrency };
      }
      lastAppliedDefaultRef.current = defaultCurrency;
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCurrency, initial?.id]);

  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  // Explicit appearance tags found by the WD-Tagger. When present and the
  // figure isn't already flagged adult, nudge the user to mark it NSFW.
  const nsfwHints = useMemo(() => nsfwTags(form.visual_tags), [form.visual_tags]);
  const suggestNsfw = nsfwHints.length > 0 && !form.is_nsfw;

  const submitLabel = useMemo(
    () => (mode === "edit" ? t("figure.form.save") : t("addfig.submit")),
    [mode, t],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = serialise(form, mode);
    await onSubmit(payload);
  };

  // Merge a lookup pick into form state: only overwrite fields the lookup
  // actually returned, leave the user's existing input otherwise.
  // `coercePickFields` first maps a pick's dual-typed fields (numeric height_mm,
  // array materials) back to the form's string representation. `*_meta` objects
  // are merged so AniList enrichment accumulates across picks.
  const applyPick = (pick) =>
    setForm((s) => {
      const coerced = coercePickFields(pick);
      const next = { ...s };
      for (const [k, v] of Object.entries(coerced)) {
        if (v === undefined || v === "") continue;
        if (k.endsWith("_meta") && v && typeof v === "object") {
          next[k] = { ...s[k], ...v };
        } else {
          next[k] = v;
        }
      }
      return next;
    });

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ──────────── Identity ──────────── */}
      <FormSection
        eyebrow={t("figure.form.section.identity.eyebrow")}
        title={t("figure.form.section.identity.title")}
      >
        <FormField
          label={t("addfig.field.name")}
          value={form.name}
          onChange={set("name")}
          required
          disabled={busy}
        />
        {/* External lookup — opens a tabbed modal (search orzgk + proxy
            boutiques, paste a link, scan a barcode, AniList). Manual entry of
            every field above/below stays fully available. */}
        <FigureLookup initial={form.name} onPick={applyPick} />
        {mode === "create" ? <DuplicateWarning name={form.name} jan={form.jan} t={t} /> : null}
        <div className="grid sm:grid-cols-2 gap-5">
          <FormField
            label={t("addfig.field.version_name")}
            value={form.version_name}
            onChange={set("version_name")}
            placeholder={t("figure.form.ph.version")}
            disabled={busy}
          />
          <FormField
            label={t("addfig.field.edition")}
            value={form.edition}
            onChange={set("edition")}
            placeholder={t("figure.form.ph.edition")}
            disabled={busy}
          />
        </div>
      </FormSection>

      {/* ──────────── Series & character ──────────── */}
      <FormSection
        eyebrow={t("figure.form.section.series.eyebrow")}
        title={t("figure.form.section.series.title")}
      >
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="sm:col-span-1">
            <EntityAutocomplete
              label={t("addfig.field.series")}
              value={form.series_name}
              onChange={set("series_name")}
              data={seriesLookup.data}
              disabled={busy}
            />
            <AniListLookup
              initial={form.series_name}
              onPick={(pick) =>
                setForm((s) => ({
                  ...s,
                  series_name: pick.romaji ?? pick.english ?? pick.native ?? s.series_name,
                  series_meta: {
                    ...s.series_meta,
                    anilist_id: pick.anilistId ?? s.series_meta?.anilist_id,
                    mal_id: pick.malId ?? s.series_meta?.mal_id,
                    description: stripHtmlSafe(pick.description) ?? s.series_meta?.description,
                    cover_url: pick.coverUrl ?? s.series_meta?.cover_url,
                    external_url: pick.siteUrl ?? s.series_meta?.external_url,
                    origin: anilistTypeToOrigin(pick.mediaType) ?? s.series_meta?.origin,
                  },
                }))
              }
            />
          </div>
          <div className="sm:col-span-1">
            <EntityAutocomplete
              label={t("addfig.field.character")}
              value={form.character_name}
              onChange={set("character_name")}
              data={charactersLookup.data}
              getMeta={(c) => c.series_name}
              disabled={busy}
            />
            <AniListCharacterLookup
              mediaId={form.series_meta?.anilist_id ?? null}
              seriesLabel={form.series_name}
              onPick={(pick) =>
                setForm((s) => ({
                  ...s,
                  character_name: pick.full ?? pick.native ?? s.character_name,
                  character_meta: {
                    ...s.character_meta,
                    anilist_id: pick.anilistId ?? s.character_meta?.anilist_id,
                    description: stripHtmlSafe(pick.description) ?? s.character_meta?.description,
                    portrait_url: pick.portraitUrl ?? s.character_meta?.portrait_url,
                    external_url: pick.siteUrl ?? s.character_meta?.external_url,
                  },
                }))
              }
            />
          </div>
        </div>
      </FormSection>

      {/* ──────────── Typology & dimensions ──────────── */}
      <FormSection
        eyebrow={t("figure.form.section.typology.eyebrow")}
        title={t("figure.form.section.typology.title")}
      >
        <div className="grid sm:grid-cols-3 gap-5">
          <Select
            label={t("addfig.field.type")}
            value={form.figure_type}
            onChange={set("figure_type")}
            options={typeOptions}
            disabled={busy}
          />
          <FormField
            label={t("addfig.field.scale")}
            value={form.scale}
            onChange={set("scale")}
            placeholder={t("figure.form.ph.scale")}
            disabled={busy}
          />
          <FormField
            label={t("addfig.field.height_mm")}
            type="number"
            value={form.height_mm}
            onChange={set("height_mm")}
            disabled={busy}
          />
        </div>
        <EntityAutocomplete
          label={t("addfig.field.materials")}
          value={form.materials}
          onChange={set("materials")}
          data={materialsLookup.data}
          multiValueSeparator=","
          placeholder={t("figure.form.ph.materials")}
          hint={t("figure.form.ph.materials_hint")}
          disabled={busy}
        />
      </FormSection>

      {/* ──────────── Production & pricing ──────────── */}
      <FormSection
        eyebrow={t("figure.form.section.production.eyebrow")}
        title={t("figure.form.section.production.title")}
      >
        <div className="grid sm:grid-cols-2 gap-5">
          <EntityAutocomplete
            label={t("addfig.field.manufacturer")}
            value={form.manufacturer_name}
            onChange={set("manufacturer_name")}
            data={manufacturersLookup.data}
            disabled={busy}
          />
          <EntityAutocomplete
            label={t("addfig.field.sculptor")}
            value={form.sculptor_name}
            onChange={set("sculptor_name")}
            data={sculptorsLookup.data}
            disabled={busy}
          />
          <FormField
            label={t("addfig.field.release_date")}
            type="date"
            value={form.release_date}
            onChange={set("release_date")}
            disabled={busy}
          />
          <FormField
            label={t("figure.spec.exclusivity")}
            value={form.exclusivity}
            onChange={set("exclusivity")}
            placeholder={t("figure.form.ph.exclusivity")}
            disabled={busy}
          />
        </div>
        <div className="grid sm:grid-cols-3 gap-5">
          <div className="sm:col-span-2">
            <FormField
              label={t("addfig.field.msrp")}
              type="number"
              value={form.msrp_amount}
              onChange={set("msrp_amount")}
              disabled={busy}
              placeholder={t("figure.form.ph.msrp")}
            />
          </div>
          <Select
            label={t("addfig.field.currency")}
            value={form.msrp_currency}
            onChange={set("msrp_currency")}
            options={currencyOptions.map((c) => ({ value: c, label: c }))}
            disabled={busy}
          />
        </div>
        <FormField
          label={t("addfig.field.jan")}
          value={form.jan}
          onChange={set("jan")}
          placeholder={t("figure.form.ph.jan")}
          hint={t("figure.form.ph.jan_hint")}
          disabled={busy}
        />
      </FormSection>

      {/* ──────────── Imagery / catalog ──────────── */}
      <FormSection
        eyebrow={t("figure.form.section.catalog.eyebrow")}
        title={t("figure.form.section.catalog.title")}
      >
        <FormField
          label={t("figure.form.field.image_url")}
          type="url"
          value={form.official_image_url}
          onChange={set("official_image_url")}
          placeholder="https://…"
          hint={t("figure.form.ph.image_url_hint")}
          disabled={busy}
        />
        <FormField label={t("figure.form.field.description")}>
          <Textarea
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            disabled={busy}
            rows={4}
            placeholder={t("figure.form.ph.description")}
            className="leading-relaxed"
          />
        </FormField>
      </FormSection>

      {/* ──────────── Content classification ──────────── */}
      <section className="relative">
        <SectionHeader
          eyebrow={t("figure.form.section.flags.eyebrow")}
          title={t("figure.form.section.flags.title")}
        />
        <div className="p-3 border border-[var(--border-subtle)] bg-[var(--surface-sunken)] hover:border-[var(--border)] transition-colors">
          <Checkbox
            checked={!!form.is_nsfw}
            onChange={set("is_nsfw")}
            disabled={busy}
            label={t("figure.form.field.is_nsfw")}
            hint={t("figure.form.field.is_nsfw_hint")}
          />
        </div>
        {/* Tag-driven NSFW nudge — sibling of the label so the action button
            doesn't toggle the checkbox. */}
        {suggestNsfw ? (
          <div className="mt-3 flex items-start gap-3 border border-[var(--danger)]/40 bg-[var(--danger-surface)] px-3 py-2.5">
            <TriangleAlert size={16} className="text-[var(--danger)] mt-0.5 shrink-0" aria-hidden />
            <div className="flex-1 min-w-0 text-sm">
              <p className="text-[var(--on-surface)]">{t("figure.form.nsfw_suggest.text")}</p>
              <p className="micro-tight mt-1 opacity-80">
                {t("figure.form.nsfw_suggest.based_on")}{" "}
                <span className="font-mono capitalize text-[var(--danger)]">
                  {nsfwHints.slice(0, 5).join(", ")}
                  {nsfwHints.length > 5 ? "…" : ""}
                </span>
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => set("is_nsfw")(true)}
              className="shrink-0 text-[10px] uppercase tracking-[0.14em] border border-[var(--danger)]/50 text-[var(--danger)] px-2.5 py-1.5 hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-50"
            >
              {t("figure.form.nsfw_suggest.action")}
            </button>
          </div>
        ) : null}
      </section>

      {/* ──────────── Appearance tags (edit-only) ──────────── */}
      {mode === "edit" && initial?.id ? (
        <section className="relative">
          <SectionHeader
            eyebrow={t("figure.form.section.tags.eyebrow", {
              default: "Recherche par description",
            })}
            title={t("figure.form.section.tags.title", { default: "Tags d'apparence" })}
          />
          <p className="micro-tight mb-3 opacity-80 max-w-xl">
            {t("figure.form.tags.hint", {
              default:
                "Générés par l'indexation (personnage, cheveux, tenue…). Modifie-les pour affiner la recherche par description ; tes changements ne seront pas écrasés.",
            })}
          </p>
          <TagsEditor
            value={form.visual_tags}
            onChange={set("visual_tags")}
            disabled={busy}
            t={t}
          />
        </section>
      ) : null}

      {/* Admin-only figure↔store M2M editor (needs a stable id to mutate). */}
      {mode === "edit" && isAdmin && initial?.id ? (
        <section className="pt-2">
          <FigureStoresEditor figureId={initial.id} />
        </section>
      ) : null}

      {extras ? <div className="pt-2">{extras}</div> : null}

      {errorMessage ? (
        <p
          role="alert"
          className="text-sm text-[var(--danger)] tracking-wide border-l-2 border-[var(--danger)] pl-3 py-1"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
        {footerExtras}
        {onCancel ? (
          <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>
            {t("editor.cancel")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

const EMPTY = {
  name: "",
  manufacturer_name: "",
  sculptor_name: "",
  series_name: "",
  character_name: "",
  figure_type: "nendoroid",
  scale: "",
  height_mm: "",
  materials: "",
  release_date: "",
  msrp_amount: "",
  msrp_currency: "JPY",
  jan: "",
  edition: "",
  exclusivity: "",
  version_name: "",
  official_image_url: "",
  description: "",
  is_nsfw: false,
  visual_tags: "",
  // Captured from a lookup pick (pasted store product URL). Sent alongside the
  // create payload so the backend can auto-link the new figure to the matching
  // store. Not persisted on the figures table — a creation-time signal.
  source_url: "",
  // Related-entity enrichment carried alongside the *_name strings. Lookups
  // (AniList, MAL, orzgk) populate these; the server upsert only persists them
  // when the matching column is currently NULL.
  manufacturer_meta: {},
  series_meta: {},
  character_meta: {},
};

/** Seed the form's local state from `initial` (a fresh figure on Edit, or
 *  undefined on Create). Lists become comma-separated strings; null fields
 *  become empty strings so React inputs stay controlled. */
function normalise(initial, defaultCurrency = "JPY") {
  if (!initial) {
    return { ...EMPTY, msrp_currency: defaultCurrency };
  }
  return {
    name: initial.name ?? "",
    manufacturer_name: initial.manufacturer_name ?? "",
    sculptor_name: initial.sculptor_name ?? "",
    series_name: initial.series_name ?? "",
    character_name: initial.character_name ?? "",
    figure_type: initial.figure_type ?? "nendoroid",
    scale: initial.scale ?? "",
    height_mm: initial.height_mm != null ? String(initial.height_mm) : "",
    materials: Array.isArray(initial.materials)
      ? initial.materials.join(", ")
      : (initial.materials ?? ""),
    release_date: initial.release_date ?? "",
    msrp_amount: initial.msrp_amount != null ? String(initial.msrp_amount) : "",
    msrp_currency: initial.msrp_currency ?? defaultCurrency,
    jan: initial.jan ?? "",
    edition: initial.edition ?? "",
    exclusivity: initial.exclusivity ?? "",
    version_name: initial.version_name ?? "",
    official_image_url: initial.official_image_url ?? "",
    description: initial.description ?? "",
    is_nsfw: !!initial.is_nsfw,
    visual_tags: initial.visual_tags ?? "",
    // Source URL is transient (only set on a fresh import); editing restarts blank.
    source_url: "",
    manufacturer_meta: initial.manufacturer_meta ?? {},
    series_meta: initial.series_meta ?? {},
    character_meta: initial.character_meta ?? {},
  };
}

/** A lookup pick may carry fields in their raw API types: orzgk's `buildPick`
 *  emits a numeric `height_mm` and an array `materials`. The form stores every
 *  field as a string, so coerce those two before merging a pick into form state
 *  (otherwise the array reaches EntityAutocomplete and its `value.trim()`
 *  throws). Mirrors the conversions `normalise()` applies. */
function coercePickFields(pick) {
  const out = { ...pick };
  if (out.height_mm != null && typeof out.height_mm !== "string") {
    out.height_mm = String(out.height_mm);
  }
  if (Array.isArray(out.materials)) {
    out.materials = out.materials.join(", ");
  }
  return out;
}

/** Produce the backend payload. Empty strings → undefined so the COALESCE-style
 *  PATCH doesn't overwrite real values with empties. Numbers parsed, materials
 *  split on comma. */
function serialise(form, mode) {
  const trim = (s) => (typeof s === "string" ? s.trim() : s);
  const nz = (s) => {
    const v = trim(s);
    return v ? v : undefined;
  };
  const parsedHeight = form.height_mm ? Number.parseInt(form.height_mm, 10) : undefined;
  const materials = form.materials ? form.materials.split(",").map(trim).filter(Boolean) : [];

  return {
    name: nz(form.name),
    manufacturer_name: nz(form.manufacturer_name),
    sculptor_name: nz(form.sculptor_name),
    series_name: nz(form.series_name),
    character_name: nz(form.character_name),
    figure_type: form.figure_type || undefined,
    scale: nz(form.scale),
    height_mm: Number.isFinite(parsedHeight) ? parsedHeight : undefined,
    materials: materials.length ? materials : undefined,
    release_date: form.release_date || undefined,
    msrp_amount: form.msrp_amount || undefined,
    msrp_currency: form.msrp_amount ? form.msrp_currency : undefined,
    jan: nz(form.jan),
    edition: nz(form.edition),
    exclusivity: nz(form.exclusivity),
    version_name: nz(form.version_name),
    official_image_url: nz(form.official_image_url),
    description: nz(form.description),
    is_nsfw: !!form.is_nsfw,
    // Appearance tags only on edit (edit-only section). Sent as a raw string —
    // incl. "" so clearing all tags reaches the server (vs `nz()`, which would
    // drop it and the COALESCE would keep the old tags).
    visual_tags: mode === "edit" ? (form.visual_tags ?? "") : undefined,
    // Source URL only forwarded on create — the backend matches its hostname
    // against `stores.url` and INSERTs into figure_stores.
    source_url: nz(form.source_url),
    manufacturer_meta: nonEmptyMeta(form.manufacturer_meta),
    series_meta: nonEmptyMeta(form.series_meta),
    character_meta: nonEmptyMeta(form.character_meta),
  };
}

/** Strip undefined / empty-string keys; undefined when nothing's left so
 *  JSON.stringify drops the whole property. */
function nonEmptyMeta(meta) {
  if (!meta || typeof meta !== "object") return undefined;
  const entries = Object.entries(meta).filter(([, v]) => {
    if (v === undefined || v === null) return false;
    if (typeof v === "string" && v.trim() === "") return false;
    return true;
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** Map AniList media type → our `series.origin` enum. */
function anilistTypeToOrigin(mediaType) {
  if (!mediaType) return undefined;
  const upper = String(mediaType).toUpperCase();
  if (upper === "ANIME") return "anime";
  if (upper === "MANGA") return "manga";
  return undefined;
}

/** Cheap HTML strip for AniList descriptions. Single-char bracket strip avoids
 *  CodeQL's smuggleable multi-char-sanitization pattern. */
function stripHtmlSafe(s) {
  if (!s) return undefined;
  return (
    String(s)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/[<>]/g, "")
      .trim() || undefined
  );
}

/** Reusable section header: kicker + display title + gold rule. */
function SectionHeader({ eyebrow, title }) {
  return (
    <header className="mb-5">
      <p className="micro-tight">{eyebrow}</p>
      <h3 className="display text-xl text-[var(--on-surface)] mt-1">{title}</h3>
      <div className="gold-rule w-12 mt-3 opacity-70" />
    </header>
  );
}

function FormSection({ eyebrow, title, children }) {
  return (
    <section className="relative">
      <SectionHeader eyebrow={eyebrow} title={title} />
      <div className="space-y-5">{children}</div>
    </section>
  );
}
