import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n, useT } from "../i18n/index.jsx";
import { useFigureTypes } from "../hooks/useAdmin.js";
import { useDefaultCurrency } from "../hooks/useMe.js";
import {
  useCharactersLookup,
  useManufacturersLookup,
  useMaterialsLookup,
  useSculptorsLookup,
  useSeriesLookup,
} from "../hooks/useEntities.js";
import { useIsAdmin } from "../hooks/useMe.js";
import AniListLookup from "./AniListLookup.jsx";
import Button from "./Button.jsx";
import EntityAutocomplete from "./EntityAutocomplete.jsx";
import FigureLookup from "./FigureLookup.jsx";
import FigureStoresEditor from "./FigureStoresEditor.jsx";
import FormField from "./FormField.jsx";
import Select from "./Select.jsx";

// Hard-coded fallback list — used only when /figure-types hasn't responded
// yet (page first-paint, offline). The live dropdown is driven from the
// admin-curated registry so custom types added at /admin/figure-types
// surface here automatically.
const TYPE_OPTIONS_FALLBACK = [
  "nendoroid", "scale", "figma", "prize", "trading",
  "statue", "plamo", "bishoujo", "dakimakura", "other",
];

const CURRENCY_OPTIONS = ["JPY", "EUR", "USD", "GBP", "CHF", "CAD"];

/**
 * Shared form for both creating (AddFigurePage) and editing (FigureEditDialog)
 * a catalog figure. Same primitives, same input types, same AniList lookup.
 *
 * Sections are visually grouped (Identity / Typology / Production / Pricing /
 * Catalogue) so the form reads like an exhibition object label rather than a
 * single 12-field dump.
 *
 * @param {object} props
 * @param {"create"|"edit"} props.mode
 * @param {object} [props.initial]    Starting values (from existing figure or empty).
 * @param {(payload: object) => Promise<void>} props.onSubmit
 *        Receives the cleaned + trimmed payload. Throw to surface an error.
 * @param {() => void} [props.onCancel]
 * @param {boolean} [props.busy]
 * @param {string} [props.errorMessage]
 * @param {object} [props.extras]     Optional render slot below the form
 *        (e.g. the "also add to my collection" checkbox on the create page).
 * @param {React.ReactNode} [props.footerExtras] Optional extra buttons.
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
  // is responsive on the first keystroke. The endpoints return only
  // {id, name, slug} (+ joined series_name for characters), so the
  // payload stays small even with hundreds of entities.
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

  // `useDefaultCurrency()` is backed by `useMe()` and starts as JPY (the
  // built-in fallback) until /api/me resolves and the user's stored
  // preference lands. Without the effect below, a user whose preference is
  // EUR would see a JPY-defaulted form on every cold page load.
  //
  // We track the last-applied default in a ref: while the field still holds
  // *that exact value*, we treat it as untouched and swap to the new
  // default. Once the user picks anything else (or the form is in Edit
  // mode where `initial.msrp_currency` is already set), the swap stops.
  const lastAppliedDefaultRef = useRef(defaultCurrency);
  useEffect(() => {
    if (!defaultCurrency) return;
    if (initial?.msrp_currency) return; // edit mode — never override
    setForm((s) => {
      // Field is the previous default → user hasn't touched it → re-seed.
      if (s.msrp_currency === lastAppliedDefaultRef.current) {
        lastAppliedDefaultRef.current = defaultCurrency;
        if (s.msrp_currency === defaultCurrency) return s;
        return { ...s, msrp_currency: defaultCurrency };
      }
      // User-modified — leave it alone but update the tracked default so
      // any future change to `defaultCurrency` is correctly bypassed.
      lastAppliedDefaultRef.current = defaultCurrency;
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCurrency, initial?.id]);

  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const submitLabel = useMemo(
    () => (mode === "edit" ? t("figure.form.save") : t("addfig.submit")),
    [mode, t],
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = serialise(form, mode);
    await onSubmit(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ──────────── Identity ──────────── */}
      <Section
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
        {/* External lookup — searches orzgk + MFC and pre-fills the form on pick. */}
        <FigureLookup
          initial={form.name}
          onPick={(pick) =>
            setForm((s) => ({
              ...s,
              // Only overwrite fields the lookup actually returned; leave
              // anything the user has already typed alone if the lookup
              // didn't fill that slot.
              ...Object.fromEntries(
                Object.entries(pick).filter(([_, v]) => v !== undefined && v !== ""),
              ),
            }))
          }
        />
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
      </Section>

      {/* ──────────── Series & character ──────────── */}
      <Section
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
                  series_name:
                    pick.romaji ?? pick.english ?? pick.native ?? s.series_name,
                  // Carry the AniList enrichment through to the server so it
                  // lands in `series.{anilist_id, mal_id, description, cover_url, …}`
                  // on first insert. Existing fields are never overwritten —
                  // the upsert uses COALESCE so admin edits stick.
                  series_meta: {
                    ...s.series_meta,
                    anilist_id: pick.anilistId ?? s.series_meta?.anilist_id,
                    mal_id: pick.malId ?? s.series_meta?.mal_id,
                    description:
                      stripHtmlSafe(pick.description) ??
                      s.series_meta?.description,
                    cover_url: pick.coverUrl ?? s.series_meta?.cover_url,
                    external_url: pick.siteUrl ?? s.series_meta?.external_url,
                    origin:
                      anilistTypeToOrigin(pick.mediaType) ??
                      s.series_meta?.origin,
                  },
                }))
              }
            />
          </div>
          <EntityAutocomplete
            label={t("addfig.field.character")}
            value={form.character_name}
            onChange={set("character_name")}
            data={charactersLookup.data}
            // Show the linked series next to the character name so
            // duplicates (e.g. multiple "Saber") are easy to tell apart.
            getMeta={(c) => c.series_name}
            disabled={busy}
          />
        </div>
      </Section>

      {/* ──────────── Typology & dimensions ──────────── */}
      <Section
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
          // Comma-separated multi-value mode: each pick replaces only the
          // token after the last comma, lets the user keep adding more.
          multiValueSeparator=","
          placeholder={t("figure.form.ph.materials")}
          hint={t("figure.form.ph.materials_hint")}
          disabled={busy}
        />
      </Section>

      {/* ──────────── Production & pricing ──────────── */}
      <Section
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
            options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
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
      </Section>

      {/* ──────────── Imagery / catalog ──────────── */}
      <Section
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
        <label className="block">
          <span className="micro block mb-2">
            {t("figure.form.field.description")}
          </span>
          <textarea
            value={form.description}
            onChange={(e) => set("description")(e.target.value)}
            disabled={busy}
            rows={4}
            placeholder={t("figure.form.ph.description")}
            className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
            style={{
              fontFamily: "var(--font-sans)",
              letterSpacing: "0.005em",
            }}
          />
        </label>
      </Section>

      {/* ──────────── Content classification ──────────── */}
      <section className="relative">
        <header className="mb-4">
          <p className="micro-tight">{t("figure.form.section.flags.eyebrow")}</p>
          <h3 className="display text-xl text-[var(--color-ivoire)] mt-1">
            {t("figure.form.section.flags.title")}
          </h3>
          <div className="gold-rule w-12 mt-3 opacity-70" />
        </header>
        <label className="flex items-start gap-3 cursor-pointer select-none p-3 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40 hover:border-[var(--color-or)]/40 transition-colors">
          <input
            type="checkbox"
            checked={!!form.is_nsfw}
            onChange={(e) => set("is_nsfw")(e.target.checked)}
            disabled={busy}
            className="accent-[var(--color-or)] w-4 h-4 mt-0.5"
          />
          <span className="flex-1 text-sm text-[var(--color-ivoire)]">
            <span className="block">{t("figure.form.field.is_nsfw")}</span>
            <span className="block micro-tight mt-1 opacity-80">
              {t("figure.form.field.is_nsfw_hint")}
            </span>
          </span>
        </label>
      </section>

      {/* Admin-only section for editing the figure↔store M2M. Only shown
       *  when editing an existing figure (we need a stable id to mutate). */}
      {mode === "edit" && isAdmin && initial?.id ? (
        <section className="pt-2">
          <FigureStoresEditor figureId={initial.id} />
        </section>
      ) : null}

      {extras ? <div className="pt-2">{extras}</div> : null}

      {errorMessage ? (
        <p
          role="alert"
          className="text-sm text-[var(--color-laque-bright)] tracking-wide border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-[var(--color-or)]/15">
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

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
  // Captured from FigureLookup.buildPick when the user imports a figure
  // by pasting a store product URL. Sent alongside the create payload so
  // the backend can auto-link the new figure to the matching store. Not
  // persisted on the figures table — purely a creation-time signal.
  source_url: "",
  // Related-entity enrichment carried alongside the *_name strings.
  // Lookups (AniList, MAL, orzgk) populate these; the upsert on the server
  // only persists them when the matching column is currently NULL.
  manufacturer_meta: {},
  series_meta: {},
  character_meta: {},
};

/** Seed the form's local state from `initial`, which can be a fresh figure
 *  (Edit) or undefined (Create). Lists become comma-separated strings; null
 *  fields become empty strings so React inputs stay controlled. */
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
    // Source URL is transient (only set when freshly imported via lookup);
    // editing an existing figure restarts blank.
    source_url: "",
    manufacturer_meta: initial.manufacturer_meta ?? {},
    series_meta: initial.series_meta ?? {},
    character_meta: initial.character_meta ?? {},
  };
}

/** Produce the payload that goes to the backend. Empty strings → undefined
 *  so the COALESCE-style PATCH on the server side doesn't overwrite real
 *  values with empties. Numbers are parsed. Materials are split on comma. */
function serialise(form, _mode) {
  const trim = (s) => (typeof s === "string" ? s.trim() : s);
  const nz = (s) => {
    const v = trim(s);
    return v ? v : undefined;
  };
  const parsedHeight = form.height_mm ? Number.parseInt(form.height_mm, 10) : undefined;
  const materials = form.materials
    ? form.materials.split(",").map(trim).filter(Boolean)
    : [];

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
    // Source URL only forwarded on create — the backend matches its
    // hostname against `stores.url` and INSERTs into figure_stores for
    // every matching store before committing the figure.
    source_url: nz(form.source_url),
    // Related-entity metadata — only included when there's at least one
    // populated field so we don't waste bytes on the wire.
    manufacturer_meta: nonEmptyMeta(form.manufacturer_meta),
    series_meta: nonEmptyMeta(form.series_meta),
    character_meta: nonEmptyMeta(form.character_meta),
  };
}

/** Strip undefined / empty-string keys; return undefined when nothing's
 *  left so JSON.stringify drops the whole property. */
function nonEmptyMeta(meta) {
  if (!meta || typeof meta !== "object") return undefined;
  const entries = Object.entries(meta).filter(([_, v]) => {
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

/** AniList descriptions sometimes contain `<br>` / `<i>`. Pretty-print
 *  cheaply for the description column (no DOMPurify dependency). Uses a
 *  single-character bracket strip — the multi-character pattern
 *  `/<[^>]+>/g` is smuggleable (`<scr<script>ipt>` → `<script>` after one
 *  pass) per CodeQL's `js/incomplete-multi-character-sanitization` rule. */
function stripHtmlSafe(s) {
  if (!s) return undefined;
  return String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[<>]/g, "")
    .trim() || undefined;
}

function Section({ eyebrow, title, children }) {
  return (
    <section className="relative">
      <header className="mb-5">
        <p className="micro-tight">{eyebrow}</p>
        <h3 className="display text-xl text-[var(--color-ivoire)] mt-1">{title}</h3>
        <div className="gold-rule w-12 mt-3 opacity-70" />
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
