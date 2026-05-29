import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button.jsx";
import FormField from "../components/FormField.jsx";
import { useT } from "../i18n/index.jsx";
import { api } from "../lib/api.js";
import { useDeleteSeries, useDeleteCharacter } from "../hooks/useAdmin.js";

/**
 * /admin/catalog — editor for the entity tables behind manufacturer / series /
 * character names. Each tab is a searchable list; clicking a row opens an
 * edit drawer with every metadata field (description, image, ids, links) and
 * an optional Garage upload widget for the cover image.
 *
 * The PATCH endpoints on the server use COALESCE, so blanking a field means
 * "leave alone" — null instead. To explicitly clear a value we'd need an
 * extra UI affordance; v1 just doesn't expose that.
 */
const TABS = ["manufacturers", "series", "characters"];

export default function AdminCatalogPage() {
  const t = useT();
  const [tab, setTab] = useState("series");
  const [editing, setEditing] = useState(null); // { kind, entity } or null
  // Delete dialog state — only series + characters can be deleted; the
  // manufacturer story is out of scope (figures.manufacturer_id is a direct
  // FK with different cascade semantics).
  const [deleting, setDeleting] = useState(null); // { kind, entity } or null

  return (
    <div>
      <header className="mb-8">
        <p className="micro">{t("admin.subtitle")}</p>
        <h2 className="display text-3xl text-[var(--color-ivoire)] mt-1">
          {t("admin.catalog.title")}
        </h2>
        <p className="text-sm text-[var(--color-ivoire-soft)] mt-2 max-w-prose">
          {t("admin.catalog.intro")}
        </p>
      </header>

      <nav className="flex items-center gap-2 mb-6 text-[10px] uppercase tracking-[0.2em]">
        {TABS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 transition-colors border-b ${
              tab === k
                ? "text-[var(--color-or)] border-[var(--color-or)]"
                : "text-[var(--color-ivoire-soft)] border-transparent hover:text-[var(--color-or-pale)]"
            }`}
          >
            {t(`admin.catalog.tab.${k}`)}
          </button>
        ))}
      </nav>

      <EntityList
        kind={tab}
        onPick={(entity) => setEditing({ kind: tab, entity })}
        onDelete={(entity) => setDeleting({ kind: tab, entity })}
      />

      {editing ? (
        <EntityEditDrawer
          kind={editing.kind}
          entity={editing.entity}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <DeleteEntityDialog
          kind={deleting.kind}
          entity={deleting.entity}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// List

function EntityList({ kind, onPick, onDelete }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const deletable = kind === "series" || kind === "characters";

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const list = useQuery({
    queryKey: ["admin", "catalog", kind, debounced],
    queryFn: () =>
      api.get(
        `/admin/${kind}?${debounced ? `q=${encodeURIComponent(debounced)}&` : ""}limit=200`,
      ),
  });

  return (
    <div>
      <div className="mb-4">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.catalog.search_placeholder")}
          aria-label={t("admin.catalog.search")}
          className="w-full max-w-md bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-sm text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
        />
      </div>

      {list.isLoading ? (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic">…</p>
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm text-[var(--color-ivoire-soft)] italic py-8 text-center">
          {t("admin.catalog.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-or)]/15 border border-[var(--color-or)]/15 bg-[var(--color-noir)]/40">
          {list.data.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--color-or)]/5"
            >
              <Thumb row={row} kind={kind} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--color-ivoire)] leading-tight truncate">
                  {row.name}
                </p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/70 mt-0.5">
                  {row.figure_count ?? 0} {t("admin.catalog.figures")} ·
                  {row.anilist_id ? " AniList" : ""}
                  {row.mal_id ? " · MAL" : ""}
                </p>
              </div>
              <Link
                to={`/${kind}/${row.slug}`}
                className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] px-2"
              >
                {t("admin.catalog.view")} ↗
              </Link>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="tap-target text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] border border-[var(--color-or)]/30 hover:border-[var(--color-or)] px-3 py-1.5 transition-all"
              >
                ✎ {t("admin.catalog.edit")}
              </button>
              {deletable ? (
                <button
                  type="button"
                  onClick={() => onDelete(row)}
                  title={t("admin.catalog.delete")}
                  className="tap-target text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-laque-bright)] border border-[var(--color-or)]/30 hover:border-[var(--color-laque-bright)] px-3 py-1.5 transition-all"
                >
                  ×
                  <span className="sr-only">{t("admin.catalog.delete")}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Thumb({ row, kind }) {
  // Pick a representative URL the same way the entity-page helper does, but
  // inline so the list doesn't have to round-trip through the server.
  const url =
    row.image_key
      ? `/api/entity-image/${kind}/${row.id}`
      : (kind === "manufacturers"
          ? row.logo_url
          : kind === "series"
            ? row.cover_url
            : row.portrait_url);
  return (
    <span className="shrink-0 w-10 h-10 bg-[var(--color-noir-deep)] border border-[var(--color-or)]/15 overflow-hidden">
      {url ? (
        <img
          src={url}
          alt={row.name ?? ""}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      ) : null}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit drawer

function EntityEditDrawer({ kind, entity, onClose }) {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState(() => seedFromEntity(kind, entity));
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [refetching, setRefetching] = useState(null); // "anilist" | "mal" | null
  const [refetchError, setRefetchError] = useState(null);

  useEffect(() => {
    setForm(seedFromEntity(kind, entity));
  }, [kind, entity?.id]);

  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  /** Refetch the entity from an external source and overwrite the local form
   *  fields (no merge — this is a deliberate override action triggered by
   *  the admin). Only invoked when the matching id is filled in. */
  const refetchFromSource = async (source /* "anilist" | "mal" */) => {
    const id = Number.parseInt(form[`${source}_id`], 10);
    if (!Number.isFinite(id)) return;
    setRefetching(source);
    setRefetchError(null);
    try {
      const fresh = await fetchExternal(kind, source, id);
      setForm((prev) => mergeFromExternal(kind, source, prev, fresh));
    } catch (e) {
      setRefetchError(e?.message ?? String(e));
    } finally {
      setRefetching(null);
    }
  };

  const patch = useMutation({
    mutationFn: (payload) =>
      api.patch(`/admin/${kind}/${entity.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "catalog", kind] });
      qc.invalidateQueries({ queryKey: ["entity", kindSingular(kind), entity.slug] });
      onClose();
    },
  });

  const submit = (e) => {
    e.preventDefault();
    const payload = serialiseForKind(kind, form);
    patch.mutate(payload);
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/admin/${kind}/${entity.id}/photo`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? `upload failed (${res.status})`);
      }
      qc.invalidateQueries({ queryKey: ["admin", "catalog", kind] });
      qc.invalidateQueries({ queryKey: ["entity", kindSingular(kind), entity.slug] });
      onClose();
    } catch (e) {
      setUploadError(e.message ?? String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="entity-edit-drawer-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 w-[95vw] max-w-2xl max-h-[92vh] flex flex-col frame-corners"
        style={{
          boxShadow:
            "0 60px 120px -50px color-mix(in oklab, var(--color-noir-deep) 85%, transparent), inset 0 1px 0 color-mix(in oklab, var(--color-ivoire) 6%, transparent)",
        }}
      >
        <header className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[var(--color-or)]/20">
          <div className="min-w-0">
            <p className="micro-tight">{t(`admin.catalog.tab.${kind}`)}</p>
            <h3 id="entity-edit-drawer-title" className="display text-xl text-[var(--color-ivoire)] mt-1 truncate">
              {entity.name}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xl -mt-1 px-2"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <FormField
            label={t("admin.catalog.field.name")}
            value={form.name}
            onChange={set("name")}
          />

          {kind === "manufacturers" ? (
            <>
              <FormField
                label={t("admin.catalog.field.country")}
                value={form.country}
                onChange={set("country")}
              />
              <FormField
                label={t("admin.catalog.field.website_url")}
                type="url"
                value={form.website_url}
                onChange={set("website_url")}
                placeholder="https://"
              />
            </>
          ) : null}

          {kind === "series" ? (
            <>
              <FormField
                label={t("admin.catalog.field.origin")}
                value={form.origin}
                onChange={set("origin")}
                hint={t("admin.catalog.field.origin_hint")}
                placeholder="anime"
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <IdWithRefetch
                  label="AniList ID"
                  value={form.anilist_id}
                  onChange={set("anilist_id")}
                  onRefetch={() => refetchFromSource("anilist")}
                  busy={refetching === "anilist"}
                  refetchLabel={t("admin.catalog.refetch")}
                />
                <IdWithRefetch
                  label="MAL ID"
                  value={form.mal_id}
                  onChange={set("mal_id")}
                  onRefetch={() => refetchFromSource("mal")}
                  busy={refetching === "mal"}
                  refetchLabel={t("admin.catalog.refetch")}
                />
              </div>
              {refetchError ? (
                <p
                  role="alert"
                  className="text-xs text-[var(--color-laque-bright)]"
                >
                  {refetchError}
                </p>
              ) : null}
            </>
          ) : null}

          {kind === "characters" ? (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                <IdWithRefetch
                  label="AniList ID"
                  value={form.anilist_id}
                  onChange={set("anilist_id")}
                  onRefetch={() => refetchFromSource("anilist")}
                  busy={refetching === "anilist"}
                  refetchLabel={t("admin.catalog.refetch")}
                />
                <IdWithRefetch
                  label="MAL ID"
                  value={form.mal_id}
                  onChange={set("mal_id")}
                  onRefetch={() => refetchFromSource("mal")}
                  busy={refetching === "mal"}
                  refetchLabel={t("admin.catalog.refetch")}
                />
              </div>
              {refetchError ? (
                <p
                  role="alert"
                  className="text-xs text-[var(--color-laque-bright)]"
                >
                  {refetchError}
                </p>
              ) : null}
            </>
          ) : null}

          {(kind === "series" || kind === "characters") ? (
            <FormField
              label={t("admin.catalog.field.external_url")}
              type="url"
              value={form.external_url}
              onChange={set("external_url")}
              placeholder="https://"
            />
          ) : null}

          <FormField
            label={t(`admin.catalog.field.image_url.${kind}`)}
            type="url"
            value={form.image_external_url}
            onChange={set("image_external_url")}
            placeholder="https://"
            hint={t("admin.catalog.field.image_url_hint")}
          />

          {/* Garage upload */}
          <div>
            <p className="micro block mb-2">
              {t("admin.catalog.field.upload")}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => uploadPhoto(e.target.files?.[0])}
                className="text-xs text-[var(--color-ivoire-soft)] file:bg-[var(--color-or)]/10 file:border file:border-[var(--color-or)]/30 file:text-[var(--color-or-pale)] file:px-3 file:py-1.5 file:text-[10px] file:uppercase file:tracking-[0.18em] file:mr-3 hover:file:bg-[var(--color-or)]/20"
                disabled={uploading}
              />
              {uploading ? (
                <span className="text-xs italic text-[var(--color-ivoire-soft)]">
                  {t("admin.catalog.uploading")}…
                </span>
              ) : null}
              {entity.image_key ? (
                <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]/70">
                  {t("admin.catalog.has_upload")}
                </span>
              ) : null}
            </div>
            {uploadError ? (
              <p
                role="alert"
                className="mt-2 text-xs text-[var(--color-laque-bright)]"
              >
                {uploadError}
              </p>
            ) : null}
          </div>

          <label className="block">
            <span className="micro block mb-2">
              {t("admin.catalog.field.description")}
            </span>
            <textarea
              value={form.description}
              onChange={(e) => set("description")(e.target.value)}
              rows={6}
              className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors leading-relaxed"
            />
          </label>

          {patch.isError ? (
            <p
              role="alert"
              className="text-sm text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
            >
              {patch.error?.message}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--color-or)]/20">
          <Button variant="ghost" type="button" onClick={onClose} disabled={patch.isPending}>
            {t("editor.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={patch.isPending}>
            {t("admin.catalog.save")}
          </Button>
        </footer>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function kindSingular(kind) {
  return kind === "series" ? "series" : kind.replace(/s$/, "");
}

function seedFromEntity(kind, e) {
  const base = {
    name: e.name ?? "",
    description: e.description ?? "",
    image_external_url:
      kind === "manufacturers"
        ? e.logo_url ?? ""
        : kind === "series"
          ? e.cover_url ?? ""
          : e.portrait_url ?? "",
  };
  if (kind === "manufacturers") {
    return { ...base, country: e.country ?? "", website_url: e.website_url ?? "" };
  }
  if (kind === "series") {
    return {
      ...base,
      origin: e.origin ?? "",
      anilist_id: e.anilist_id != null ? String(e.anilist_id) : "",
      mal_id: e.mal_id != null ? String(e.mal_id) : "",
      external_url: e.external_url ?? "",
    };
  }
  return {
    ...base,
    anilist_id: e.anilist_id != null ? String(e.anilist_id) : "",
    mal_id: e.mal_id != null ? String(e.mal_id) : "",
    external_url: e.external_url ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Refetch from source

/** Numeric ID input + a "↻ Refetch" button that fires when the id is
 *  populated. Disabled while a fetch is in-flight or when the value is
 *  empty / non-numeric. */
function IdWithRefetch({ label, value, onChange, onRefetch, busy, refetchLabel }) {
  const hasId = value != null && value !== "" && Number.isFinite(Number(value));
  return (
    <div>
      <FormField label={label} type="number" value={value} onChange={onChange} />
      <button
        type="button"
        onClick={onRefetch}
        disabled={!hasId || busy}
        className="mt-1.5 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? "…" : "↻"} {refetchLabel}
      </button>
    </div>
  );
}

/** Fetch the source-of-truth payload for the given (kind, source, id). */
async function fetchExternal(kind, source, id) {
  if (source === "anilist") {
    if (kind === "series") return api.get(`/external/anilist/${id}`);
    if (kind === "characters") return api.get(`/external/anilist/character/${id}`);
  }
  if (source === "mal") {
    if (kind === "series") return api.get(`/external/mal/anime/${id}`);
    if (kind === "characters") return api.get(`/external/mal/character/${id}`);
  }
  throw new Error(`unsupported refetch: ${kind} × ${source}`);
}

/** Merge fresh upstream data into the local form state.
 *
 * This is a deliberate **override** for every field the upstream populates —
 * the admin clicked "refetch" specifically to overwrite stale local copies.
 * Fields the upstream doesn't expose are left untouched.
 */
function mergeFromExternal(kind, source, prev, fresh) {
  if (kind === "series" && source === "anilist") {
    const m = fresh?.media ?? fresh;
    if (!m) return prev;
    return {
      ...prev,
      name:
        m.title?.romaji ?? m.title?.english ?? m.title?.native ?? prev.name,
      description: stripHtml(m.description) ?? prev.description,
      image_external_url:
        m.coverImage?.large ?? m.coverImage?.medium ?? prev.image_external_url,
      external_url: m.siteUrl ?? prev.external_url,
      origin: anilistTypeToOrigin(m.type) ?? prev.origin,
      // Cross-populate the other id when AniList knows it.
      mal_id: m.idMal != null ? String(m.idMal) : prev.mal_id,
    };
  }
  if (kind === "series" && source === "mal") {
    return {
      ...prev,
      name: fresh.title ?? fresh.title_english ?? prev.name,
      description: fresh.synopsis ?? prev.description,
      image_external_url: bestMalImage(fresh.images) ?? prev.image_external_url,
      external_url: fresh.url ?? prev.external_url,
    };
  }
  if (kind === "characters" && source === "anilist") {
    return {
      ...prev,
      name: fresh.name?.full ?? fresh.name?.native ?? prev.name,
      description: stripHtml(fresh.description) ?? prev.description,
      image_external_url:
        fresh.image?.large ?? fresh.image?.medium ?? prev.image_external_url,
      external_url: fresh.siteUrl ?? prev.external_url,
    };
  }
  if (kind === "characters" && source === "mal") {
    return {
      ...prev,
      name: fresh.name ?? prev.name,
      description: fresh.about ?? prev.description,
      image_external_url: bestMalImage(fresh.images) ?? prev.image_external_url,
      external_url: fresh.url ?? prev.external_url,
    };
  }
  return prev;
}

function bestMalImage(images) {
  if (!images) return null;
  return (
    images.webp?.large_image_url ??
    images.webp?.image_url ??
    images.jpg?.large_image_url ??
    images.jpg?.image_url ??
    null
  );
}

function anilistTypeToOrigin(mediaType) {
  if (!mediaType) return undefined;
  const u = String(mediaType).toUpperCase();
  if (u === "ANIME") return "anime";
  if (u === "MANGA") return "manga";
  return undefined;
}

/** Cheap AniList HTML stripper — descriptions occasionally include `<br>`
 *  / `<i>` even with `asHtml: false`. The `[<>]` single-character pass is
 *  what CodeQL recommends for `js/incomplete-multi-character-sanitization`:
 *  a broad `/<[^>]+>/g` is smuggleable by nested `<scr<script>ipt>` style
 *  payloads, the bracket-strip can't be. We also keep `<br>` → `\n` first
 *  so paragraph breaks aren't lost. */
function stripHtml(s) {
  if (s == null) return undefined;
  const out = String(s)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/[<>]/g, "")
    .trim();
  return out || undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

function serialiseForKind(kind, form) {
  const trim = (s) => (typeof s === "string" ? s.trim() : s);
  const nz = (s) => (trim(s) ? trim(s) : undefined);
  const int = (s) => {
    if (!s || s === "") return undefined;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const common = {
    name: nz(form.name),
    description: nz(form.description),
  };
  if (kind === "manufacturers") {
    return {
      ...common,
      country: nz(form.country),
      website_url: nz(form.website_url),
      logo_url: nz(form.image_external_url),
    };
  }
  if (kind === "series") {
    return {
      ...common,
      origin: nz(form.origin),
      anilist_id: int(form.anilist_id),
      mal_id: int(form.mal_id),
      external_url: nz(form.external_url),
      cover_url: nz(form.image_external_url),
    };
  }
  return {
    ...common,
    anilist_id: int(form.anilist_id),
    mal_id: int(form.mal_id),
    external_url: nz(form.external_url),
    portrait_url: nz(form.image_external_url),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete dialog — shown for series + characters tabs. Surfaces the figure
// count, offers an optional replacement (full merge: figures + children),
// and falls back to "leave orphans" (figure_series cascades, characters
// get series_id = NULL via the ON DELETE SET NULL clause).
// ─────────────────────────────────────────────────────────────────────────────

function DeleteEntityDialog({ kind, entity, onClose }) {
  const t = useT();
  // Singular API verb: series stays "series" (Latin invariable), characters
  // → "character". We need it for both the lookup endpoint and the i18n key.
  const singular = kindSingular(kind); // "series" | "character"
  const [replacementId, setReplacementId] = useState("");

  // Pull every other entity of the same kind for the replacement picker.
  // Distinct cache key from the searchable list above (different limit, and
  // we don't want a stray user search filtering the merge target).
  const targets = useQuery({
    queryKey: ["admin", "catalog", kind, "all-for-merge"],
    queryFn: () => api.get(`/admin/${kind}?limit=500`),
  });

  const deleteSeries = useDeleteSeries();
  const deleteCharacter = useDeleteCharacter();
  const mut = kind === "series" ? deleteSeries : deleteCharacter;

  const onConfirm = async () => {
    await mut.mutateAsync({
      id: entity.id,
      replacementId: replacementId || null,
    });
    onClose();
  };

  const figureCount = entity.figure_count ?? 0;
  const candidates = (targets.data ?? []).filter((row) => row.id !== entity.id);

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-6"
      >
        <p className="micro">{t("admin.catalog.delete")}</p>
        <h3 className="display text-xl text-[var(--color-ivoire)] mt-1 truncate">
          {entity.name}
        </h3>
        <div className="gold-rule w-12 mt-3 mb-4 opacity-70" />

        <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
          {figureCount > 0
            ? t(`admin.catalog.delete_body.${singular}_with_figures`, {
                n: figureCount,
              })
            : t(`admin.catalog.delete_body.${singular}_empty`)}
        </p>

        {figureCount > 0 ? (
          <label className="block mt-5">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]">
              {t("admin.catalog.delete_replacement_label")}
            </span>
            <select
              value={replacementId}
              onChange={(e) => setReplacementId(e.target.value)}
              disabled={targets.isLoading || mut.isPending}
              className="mt-2 w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-sm text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
            >
              <option value="">
                {t("admin.catalog.delete_replacement_none")}
              </option>
              {candidates.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                  {row.figure_count ? ` (${row.figure_count})` : ""}
                </option>
              ))}
            </select>
            <span className="block mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/60">
              {replacementId
                ? t(`admin.catalog.delete_hint.${singular}_merge`)
                : t(`admin.catalog.delete_hint.${singular}_orphan`)}
            </span>
          </label>
        ) : null}

        {mut.isError ? (
          <p
            role="alert"
            className="mt-4 text-xs text-[var(--color-laque-bright)] border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
          >
            {mut.error?.message}
          </p>
        ) : null}

        <div className="flex justify-end items-center gap-3 mt-6">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={mut.isPending}
          >
            {t("editor.cancel")}
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={mut.isPending}
            className="inline-flex items-center justify-center px-6 py-3 font-medium tracking-wide border border-[var(--color-laque-bright)] text-[var(--color-laque-bright)] hover:bg-[var(--color-laque-bright)] hover:text-[var(--color-noir)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("admin.catalog.delete_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

