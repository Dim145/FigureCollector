import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminSettings,
  useAdminOverview,
  useReindexVisualSearch,
  useReindexTextSearch,
  useReindexClipSearch,
  useReindexTags,
  useReindexOwnedTags,
  useReindexAll,
  useUpdateAdminSettings,
} from "../hooks/useAdmin.js";
import { useVisualSearchStatus } from "../hooks/useVisualSearch.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import { Modal } from "../components/ui/index.js";

/**
 * Admin · Réglages — Direction A ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * sub-nav already sit above. This is an editorial *section* of the admin
 * surface (kicker · 設 · label → AccentTitle h2 → gold-rule → italic gloss
 * over a faint kanji-mark), mirroring AdminNotificationsPage.
 *
 * First setting: the gsplat creation policy — who may launch a 3D
 * model. Training is GPU-heavy, so an admin can reserve it to admins only;
 * when they do, the "Modèle 3D" checkbox is hidden for everyone else (and the
 * backend enforces it on the upload route — defense in depth). The control is
 * a pair of A radio rows (gold-rim noir wells, a hanko-red diamond marking the
 * active choice) over a hanko-red primary save button with dirty-tracking.
 */
export default function AdminSettingsPage() {
  const t = useT();
  const settings = useAdminSettings();
  const update = useUpdateAdminSettings();
  const updateCron = useUpdateAdminSettings();
  const updateVs = useUpdateAdminSettings();
  const reindex = useReindexVisualSearch();
  const reindexText = useReindexTextSearch();
  const reindexClip = useReindexClipSearch();
  const reindexTags = useReindexTags();
  const reindexOwnedTags = useReindexOwnedTags();
  const reindexAll = useReindexAll();
  const vsStatus = useVisualSearchStatus();
  const overview = useAdminOverview();

  // The server value is the source of truth; the drafts hold each section's
  // pending edit (null = nothing unsaved). Deriving the live values during
  // render sidesteps a sync effect and re-syncs for free once a save refetches.
  const [draft, setDraft] = useState(null);
  const [cronDraft, setCronDraft] = useState(null);
  // Photo-search section drafts (null = unchanged). The API key is write-only:
  // `keyDraft === null` means "leave the stored key as is".
  const [vsDraft, setVsDraft] = useState(null);
  const [vsExtDraft, setVsExtDraft] = useState(null);
  const [keyDraft, setKeyDraft] = useState(null);
  const [thresholdDraft, setThresholdDraft] = useState(null);
  const [ambiancesDraft, setAmbiancesDraft] = useState(null);
  const [textSearchDraft, setTextSearchDraft] = useState(null);
  const [minMatchDraft, setMinMatchDraft] = useState(null);
  const [clipSearchDraft, setClipSearchDraft] = useState(null);
  const [clipMinMatchDraft, setClipMinMatchDraft] = useState(null);
  const [appearanceTagsDraft, setAppearanceTagsDraft] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  if (settings.isLoading) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-center text-[var(--color-ivoire-soft)] py-12"
      >
        …
      </p>
    );
  }
  if (!settings.data) return null;

  const saved = settings.data.gsplat_creation_policy;
  const policy = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  const savedCron = settings.data.price_cron ?? "";
  const cron = cronDraft ?? savedCron;
  const cronDirty = cronDraft !== null && cronDraft.trim() !== savedCron.trim();

  // ─── Photo-search section ───
  const savedVs = !!settings.data.visual_search;
  const vs = vsDraft ?? savedVs;
  const savedVsExt = !!settings.data.visual_search_external;
  const vsExt = vsExtDraft ?? savedVsExt;
  const keyStored = !!settings.data.visual_search_external_key_set;
  const savedThreshold = Math.round(
    settings.data.visual_search_similarity_threshold ?? 75,
  );
  const savedAmbiances = !!settings.data.visual_search_ambiances;
  const ambiances = ambiancesDraft ?? savedAmbiances;
  const savedTextSearch = !!settings.data.text_search;
  const textSearch = textSearchDraft ?? savedTextSearch;
  const savedMinMatch = Math.round(settings.data.text_search_min_match ?? 0);
  const minMatch = minMatchDraft ?? savedMinMatch;
  const savedClipSearch = !!settings.data.clip_search;
  const clipSearch = clipSearchDraft ?? savedClipSearch;
  const savedClipMinMatch = Math.round(settings.data.clip_search_min_match ?? 0);
  const clipMinMatch = clipMinMatchDraft ?? savedClipMinMatch;
  const savedAppearanceTags = !!settings.data.appearance_tags;
  const appearanceTags = appearanceTagsDraft ?? savedAppearanceTags;
  const vsDirty =
    (vsDraft !== null && vsDraft !== savedVs) ||
    (vsExtDraft !== null && vsExtDraft !== savedVsExt) ||
    keyDraft !== null ||
    (thresholdDraft !== null && thresholdDraft !== savedThreshold) ||
    (ambiancesDraft !== null && ambiancesDraft !== savedAmbiances) ||
    (textSearchDraft !== null && textSearchDraft !== savedTextSearch) ||
    (minMatchDraft !== null && minMatchDraft !== savedMinMatch) ||
    (clipSearchDraft !== null && clipSearchDraft !== savedClipSearch) ||
    (clipMinMatchDraft !== null && clipMinMatchDraft !== savedClipMinMatch) ||
    (appearanceTagsDraft !== null && appearanceTagsDraft !== savedAppearanceTags);
  const saveVs = () => {
    const patch = {};
    if (vsDraft !== null) patch.visual_search = vsDraft;
    if (vsExtDraft !== null) patch.visual_search_external = vsExtDraft;
    if (keyDraft !== null) patch.visual_search_external_key = keyDraft;
    if (thresholdDraft !== null)
      patch.visual_search_similarity_threshold = thresholdDraft;
    if (ambiancesDraft !== null) patch.visual_search_ambiances = ambiancesDraft;
    if (textSearchDraft !== null) patch.text_search = textSearchDraft;
    if (minMatchDraft !== null) patch.text_search_min_match = minMatchDraft;
    if (clipSearchDraft !== null) patch.clip_search = clipSearchDraft;
    if (clipMinMatchDraft !== null) patch.clip_search_min_match = clipMinMatchDraft;
    if (appearanceTagsDraft !== null) patch.appearance_tags = appearanceTagsDraft;
    updateVs.mutate(patch, {
      onSuccess: () => {
        setVsDraft(null);
        setVsExtDraft(null);
        setKeyDraft(null);
        setThresholdDraft(null);
        setAmbiancesDraft(null);
        setTextSearchDraft(null);
        setMinMatchDraft(null);
        setClipSearchDraft(null);
        setClipMinMatchDraft(null);
        setAppearanceTagsDraft(null);
      },
    });
  };

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-10">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] -top-24 -right-6 hidden md:block select-none"
        >
          設
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.settings.subtitle")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            設
          </span>
          {t("admin.settings.kicker_label")}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.settings.title")} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="display-italic text-[var(--color-or)] text-base md:text-lg mt-4 max-w-2xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.settings.body")}
        </p>
      </header>

      {/* ─── 3D-model creation policy ─── */}
      <div className="reveal" style={{ "--i": 4 }}>
        <Card className="p-6 md:p-8">
          {/* Card sub-header — kanji marker + kicker + title + gold-rule. */}
          <p className="micro flex items-center gap-2.5">
            <span
              aria-hidden
              className="ja not-italic text-[var(--color-or)] text-base leading-none"
            >
              模
            </span>
            {t("admin.settings.gsplat.kicker")}
          </p>
          <h3 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)]">
            {t("admin.settings.gsplat.title")}
          </h3>
          <div className="gold-rule w-12 mt-4 mb-4" />
          <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
            {t("admin.settings.gsplat.desc")}
          </p>

          {/* Policy choice — two A radio rows. */}
          <div
            role="radiogroup"
            aria-label={t("admin.settings.gsplat.title")}
            className="mt-6 space-y-3"
          >
            <PolicyOption
              value="everyone"
              active={policy === "everyone"}
              label={t("admin.settings.gsplat.everyone")}
              desc={t("admin.settings.gsplat.everyone_desc")}
              onSelect={() => setDraft("everyone")}
            />
            <PolicyOption
              value="admins_only"
              active={policy === "admins_only"}
              label={t("admin.settings.gsplat.admins_only")}
              desc={t("admin.settings.gsplat.admins_only_desc")}
              onSelect={() => setDraft("admins_only")}
            />
          </div>

          {/* Save row — hanko-red primary, dirty-gated, with a quiet receipt. */}
          <div className="mt-7 flex items-center justify-end gap-4">
            {update.isSuccess && !dirty ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs tracking-wide text-[var(--color-or)]"
              >
                {t("admin.settings.saved")}
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={() =>
                update.mutate(
                  { gsplat_creation_policy: policy },
                  { onSuccess: () => setDraft(null) },
                )
              }
              disabled={!dirty || update.isPending}
              loading={update.isPending}
            >
              {t("admin.settings.save")}
            </Button>
          </div>
        </Card>
      </div>

      {/* ─── Cote auto-pricing cron ─── */}
      <div className="reveal mt-8" style={{ "--i": 5 }}>
        <Card className="p-6 md:p-8">
          <p className="micro flex items-center gap-2.5">
            <span
              aria-hidden
              className="ja not-italic text-[var(--color-or)] text-base leading-none"
            >
              価
            </span>
            {t("admin.settings.cote.kicker")}
          </p>
          <h3 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)]">
            {t("admin.settings.cote.title")}
          </h3>
          <div className="gold-rule w-12 mt-4 mb-4" />
          <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
            {t("admin.settings.cote.desc")}
          </p>

          <label className="block mt-6 max-w-md">
            <span className="micro block mb-2">
              {t("admin.settings.cote.schedule_label")}
            </span>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCronDraft(e.target.value)}
              placeholder="0 3 * * *"
              spellCheck={false}
              autoComplete="off"
              aria-label={t("admin.settings.cote.schedule_label")}
              className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none transition-colors focus:border-[var(--color-or)]"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
            />
            <span className="mt-2 block text-xs text-[var(--color-ivoire-soft)] leading-relaxed">
              {t("admin.settings.cote.schedule_hint")}
            </span>
          </label>

          {/* Enabled/disabled reflects the SAVED schedule — the system's real
              state — never the unsaved draft (which only drives dirty/save). */}
          <p
            className="mt-3 text-[11px] uppercase tracking-[0.18em]"
            style={{
              color: savedCron.trim()
                ? "var(--color-or)"
                : "var(--color-ivoire-soft)",
            }}
          >
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rotate-45 mr-2 align-middle"
              style={{
                background: savedCron.trim()
                  ? "var(--color-or)"
                  : "color-mix(in oklab, var(--color-ivoire-soft) 55%, transparent)",
              }}
            />
            {savedCron.trim()
              ? t("admin.settings.cote.enabled")
              : t("admin.settings.cote.disabled")}
          </p>

          <div className="mt-6 flex items-center justify-end gap-4">
            {updateCron.isError ? (
              <p role="alert" className="text-xs text-[var(--color-laque-bright)]">
                {t("admin.settings.cote.invalid")}
              </p>
            ) : updateCron.isSuccess && !cronDirty ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs tracking-wide text-[var(--color-or)]"
              >
                {t("admin.settings.saved")}
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={() =>
                updateCron.mutate(
                  { price_cron: cron.trim() },
                  { onSuccess: () => setCronDraft(null) },
                )
              }
              disabled={!cronDirty || updateCron.isPending}
              loading={updateCron.isPending}
            >
              {t("admin.settings.save")}
            </Button>
          </div>
        </Card>
      </div>

      {/* ─── Photo (visual) search ─── */}
      <div className="reveal mt-8" style={{ "--i": 6 }}>
        <Card className="p-6 md:p-8">
          <p className="micro flex items-center gap-2.5">
            <span
              aria-hidden
              className="ja not-italic text-[var(--color-or)] text-base leading-none"
            >
              視
            </span>
            {t("admin.settings.visual.kicker")}
          </p>
          <h3 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)]">
            {t("admin.settings.visual.title")}
          </h3>
          <div className="gold-rule w-12 mt-4 mb-4" />
          <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
            {t("admin.settings.visual.desc")}
          </p>

          {/* Master enable toggle */}
          <div className="atelier-toggle-row mt-6">
            <div id="vs-enable-label" className="atelier-toggle-row-text">
              <span className={`atelier-toggle-row-state ${vs ? "is-on" : ""}`}>
                {vs
                  ? t("admin.settings.visual.enable_on")
                  : t("admin.settings.visual.enable_off")}
              </span>
              <span className="atelier-toggle-row-hint">
                {t("admin.settings.visual.enable_hint")}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={vs}
              aria-labelledby="vs-enable-label"
              onClick={() => setVsDraft(!vs)}
              className={`atelier-toggle ${vs ? "is-on" : ""}`}
            />
          </div>

          {/* Index status + re-index */}
          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <div className="text-xs text-[var(--color-ivoire-soft)] leading-relaxed">
              {vsStatus.data ? (
                <>
                  <p>
                    {t("admin.settings.visual.index_status", {
                      embedded: vsStatus.data.embedded ?? 0,
                      pending: vsStatus.data.pending ?? 0,
                    })}
                  </p>
                  <p
                    className="mt-1"
                    style={{
                      color: vsStatus.data.worker_present
                        ? "var(--color-or)"
                        : "var(--color-ivoire-soft)",
                    }}
                  >
                    <span
                      aria-hidden
                      className="inline-block w-1.5 h-1.5 rotate-45 mr-2 align-middle"
                      style={{
                        background: vsStatus.data.worker_present
                          ? "var(--color-or)"
                          : "color-mix(in oklab, var(--color-ivoire-soft) 55%, transparent)",
                      }}
                    />
                    {vsStatus.data.worker_present
                      ? t("admin.settings.visual.worker_on")
                      : t("admin.settings.visual.worker_off")}
                  </p>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {reindex.isSuccess ? (
                <p role="status" className="text-xs text-[var(--color-or)]">
                  {t("admin.settings.visual.reindex_done", {
                    queued: reindex.data?.queued ?? 0,
                  })}
                </p>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reindex.mutate()}
                disabled={!savedVs || reindex.isPending}
                loading={reindex.isPending}
              >
                {t("admin.settings.visual.reindex")}
              </Button>
              <ForceButton
                t={t}
                busy={!savedVs || reindex.isPending}
                onForce={() => reindex.mutate({ force: true })}
              />
            </div>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-ivoire-soft)]/70">
            {t("admin.settings.visual.reindex_hint")}
          </p>

          {/* External (Google Vision) fallback */}
          <div className="mt-7 pt-6 border-t border-dashed border-[var(--color-or)]/20">
            <div className={`atelier-toggle-row ${!vs ? "opacity-50" : ""}`}>
              <div id="vs-ext-label" className="atelier-toggle-row-text">
                <span className={`atelier-toggle-row-state ${vsExt ? "is-on" : ""}`}>
                  {vsExt
                    ? t("admin.settings.visual.external_on")
                    : t("admin.settings.visual.external_off")}
                </span>
                <span className="atelier-toggle-row-hint">
                  {t("admin.settings.visual.external_hint")}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={vsExt}
                aria-labelledby="vs-ext-label"
                onClick={() => setVsExtDraft(!vsExt)}
                disabled={!vs}
                className={`atelier-toggle ${vsExt ? "is-on" : ""}`}
              />
            </div>

            <label className="block mt-5 max-w-md">
              <span className="micro block mb-2">
                {t("admin.settings.visual.key_label")}
              </span>
              <input
                type="password"
                value={keyDraft ?? ""}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={t("admin.settings.visual.key_placeholder")}
                spellCheck={false}
                autoComplete="off"
                disabled={!vs}
                aria-label={t("admin.settings.visual.key_label")}
                className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none transition-colors focus:border-[var(--color-or)] disabled:opacity-50"
                style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}
              />
              <span
                className="mt-2 block text-xs leading-relaxed"
                style={{
                  color: keyStored
                    ? "var(--color-or-pale)"
                    : "var(--color-ivoire-soft)",
                }}
              >
                {keyStored
                  ? t("admin.settings.visual.key_set")
                  : t("admin.settings.visual.key_unset")}
              </span>
            </label>
          </div>

          {/* Similarity threshold — the match floor for the "figurines
              proches" / "recommandé pour toi" discovery rails. */}
          <div className="mt-7 pt-6 border-t border-[var(--color-or)]/15">
            <label className="block max-w-md">
              <span className="micro block mb-3">
                {t("admin.settings.visual.threshold_label", {
                  default: "Seuil de similarité",
                })}
              </span>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={thresholdDraft ?? savedThreshold}
                  onChange={(e) => setThresholdDraft(Number(e.target.value))}
                  disabled={!vs}
                  aria-label={t("admin.settings.visual.threshold_label", {
                    default: "Seuil de similarité",
                  })}
                  className="flex-1 accent-[var(--color-laque-bright)] disabled:opacity-50"
                />
                <span className="font-mono text-sm text-[var(--color-or)] w-12 text-right tabular-nums">
                  {thresholdDraft ?? savedThreshold}%
                </span>
              </div>
              <span className="mt-2 block text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
                {t("admin.settings.visual.threshold_hint", {
                  default:
                    "En-dessous de ce seuil, une figurine n'est proposée ni comme « proche » ni comme « recommandée ». Plus haut = moins de suggestions, mais plus pertinentes.",
                })}
              </span>
            </label>
          </div>

          {/* Ambiances — opt-in clustering view, off by default. */}
          <div className="mt-7 pt-6 border-t border-[var(--color-or)]/15">
            <div className="atelier-toggle-row">
              <div id="vs-ambiances-label" className="atelier-toggle-row-text">
                <span className="flex items-center gap-2">
                  <span className={`atelier-toggle-row-state ${ambiances ? "is-on" : ""}`}>
                    {ambiances
                      ? t("admin.settings.visual.ambiances_on", { default: "Ambiances activées" })
                      : t("admin.settings.visual.ambiances_off", { default: "Ambiances désactivées" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    aria-label={t("admin.settings.visual.ambiances_help_aria", {
                      default: "Qu'est-ce qu'une ambiance ?",
                    })}
                    title={t("admin.settings.visual.ambiances_help_aria", {
                      default: "Qu'est-ce qu'une ambiance ?",
                    })}
                    className="shrink-0 grid place-items-center w-5 h-5 rounded-full border border-[var(--color-or)]/40 text-[var(--color-or)] text-[11px] leading-none hover:bg-[var(--color-or)]/15 transition-colors"
                  >
                    ?
                  </button>
                </span>
                <span className="atelier-toggle-row-hint">
                  {t("admin.settings.visual.ambiances_hint", {
                    default:
                      "Regroupe le catalogue en familles d'allure visuelle (mêmes poses, couleurs, style). Pertinent à partir d'une cinquantaine de figurines variées.",
                  })}
                </span>
                {typeof overview.data?.figure_count === "number" ? (
                  <span className="mt-1 block font-mono not-italic text-[11px] text-[var(--color-ivoire-soft)]/55">
                    {t("admin.settings.visual.ambiances_count", {
                      n: overview.data.figure_count,
                      default: `Catalogue actuel : ${overview.data.figure_count}.`,
                    })}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={ambiances}
                aria-labelledby="vs-ambiances-label"
                onClick={() => setAmbiancesDraft(!ambiances)}
                disabled={!vs}
                className={`atelier-toggle ${ambiances ? "is-on" : ""} ${!vs ? "opacity-40 pointer-events-none" : ""}`}
              />
            </div>
          </div>

          {/* Semantic text search — opt-in, independent of photo search. */}
          <div className="mt-7 pt-6 border-t border-[var(--color-or)]/15">
            <div className="atelier-toggle-row">
              <div id="vs-text-label" className="atelier-toggle-row-text">
                <span className={`atelier-toggle-row-state ${textSearch ? "is-on" : ""}`}>
                  {textSearch
                    ? t("admin.settings.visual.text_on", { default: "Recherche par le sens activée" })
                    : t("admin.settings.visual.text_off", { default: "Recherche par le sens désactivée" })}
                </span>
                <span className="atelier-toggle-row-hint">
                  {t("admin.settings.visual.text_hint", {
                    default:
                      "Ajoute un mode « Sens » à la recherche : retrouver une figurine par une description, pas seulement par mots-clés. Indexe d'abord les textes ci-dessous.",
                  })}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={textSearch}
                aria-labelledby="vs-text-label"
                onClick={() => setTextSearchDraft(!textSearch)}
                className={`atelier-toggle ${textSearch ? "is-on" : ""}`}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => reindexText.mutate()}
                disabled={reindexText.isPending}
                className="px-3 py-1.5 border border-[var(--color-or)]/30 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 transition-colors disabled:opacity-50"
              >
                {t("admin.settings.visual.text_reindex", { default: "Indexer les textes" })}
              </button>
              <ForceButton
                t={t}
                busy={reindexText.isPending}
                onForce={() => reindexText.mutate({ force: true })}
              />
              {typeof vsStatus.data?.text_embedded === "number" ? (
                <span className="font-mono text-[11px] text-[var(--color-ivoire-soft)]">
                  {t("admin.settings.visual.text_indexed", {
                    n: vsStatus.data.text_embedded,
                    default: `${vsStatus.data.text_embedded} indexées`,
                  })}
                </span>
              ) : null}
              {reindexText.isSuccess ? (
                <span className="text-[11px] text-[var(--color-jade)]">
                  {t("admin.settings.visual.text_reindex_done", { default: "File alimentée." })}
                </span>
              ) : null}
            </div>
            {/* Semantic match floor — minimum "% match" for a "Sens" result to
                show. e5 packs similarity into a high band, so this mostly trims
                the weak tail; 0 % keeps every hit. */}
            <label className="mt-6 block max-w-md">
              <span className="micro block mb-3">
                {t("admin.settings.visual.text_min_match_label", {
                  default: "Pertinence minimale",
                })}
              </span>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={minMatch}
                  onChange={(e) => setMinMatchDraft(Number(e.target.value))}
                  disabled={!textSearch}
                  aria-label={t("admin.settings.visual.text_min_match_label", {
                    default: "Pertinence minimale",
                  })}
                  className="flex-1 accent-[var(--color-laque-bright)] disabled:opacity-50"
                />
                <span className="font-mono text-sm text-[var(--color-or)] w-12 text-right tabular-nums">
                  {minMatch} %
                </span>
              </div>
              <span className="mt-2 block text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
                {t("admin.settings.visual.text_min_match_hint", {
                  default:
                    "Score minimum pour qu'un résultat « Sens » s'affiche. e5 resserre les scores dans une bande haute (~80–90 %) : monte ce seuil pour couper la queue de résultats faibles. 0 % affiche tout.",
                })}
              </span>
            </label>
          </div>

          {/* Multimodal "search by look" (SigLIP) — opt-in, independent. */}
          <div className="mt-7 pt-6 border-t border-[var(--color-or)]/15">
            <div className="atelier-toggle-row">
              <div id="vs-clip-label" className="atelier-toggle-row-text">
                <span className={`atelier-toggle-row-state ${clipSearch ? "is-on" : ""}`}>
                  {clipSearch
                    ? t("admin.settings.visual.clip_on", {
                        default: "Recherche par l'apparence activée",
                      })
                    : t("admin.settings.visual.clip_off", {
                        default: "Recherche par l'apparence désactivée",
                      })}
                </span>
                <span className="atelier-toggle-row-hint">
                  {t("admin.settings.visual.clip_hint", {
                    default:
                      "Ajoute un mode « Apparence » : retrouver une figurine en décrivant à quoi elle ressemble (pose, cheveux, tenue), via SigLIP. Indexe d'abord les images ci-dessous ; le modèle texte (~283 Mo) ne se charge qu'à l'usage.",
                  })}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={clipSearch}
                aria-labelledby="vs-clip-label"
                onClick={() => setClipSearchDraft(!clipSearch)}
                className={`atelier-toggle ${clipSearch ? "is-on" : ""}`}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => reindexClip.mutate()}
                disabled={reindexClip.isPending}
                className="px-3 py-1.5 border border-[var(--color-or)]/30 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 transition-colors disabled:opacity-50"
              >
                {t("admin.settings.visual.clip_reindex", {
                  default: "Indexer les images (apparence)",
                })}
              </button>
              <ForceButton
                t={t}
                busy={reindexClip.isPending}
                onForce={() => reindexClip.mutate({ force: true })}
              />
              {typeof vsStatus.data?.clip_embedded === "number" ? (
                <span className="font-mono text-[11px] text-[var(--color-ivoire-soft)]">
                  {t("admin.settings.visual.clip_indexed", {
                    n: vsStatus.data.clip_embedded,
                    default: `${vsStatus.data.clip_embedded} indexées`,
                  })}
                </span>
              ) : null}
              {reindexClip.isSuccess ? (
                <span className="text-[11px] text-[var(--color-jade)]">
                  {t("admin.settings.visual.text_reindex_done", { default: "File alimentée." })}
                </span>
              ) : null}
            </div>
            <label className="mt-6 block max-w-md">
              <span className="micro block mb-3">
                {t("admin.settings.visual.clip_min_match_label", {
                  default: "Pertinence minimale",
                })}
              </span>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={clipMinMatch}
                  onChange={(e) => setClipMinMatchDraft(Number(e.target.value))}
                  disabled={!clipSearch}
                  aria-label={t("admin.settings.visual.clip_min_match_label", {
                    default: "Pertinence minimale",
                  })}
                  className="flex-1 accent-[var(--color-laque-bright)] disabled:opacity-50"
                />
                <span className="font-mono text-sm text-[var(--color-or)] w-12 text-right tabular-nums">
                  {clipMinMatch} %
                </span>
              </div>
              <span className="mt-2 block text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
                {t("admin.settings.visual.clip_min_match_hint", {
                  default:
                    "Score minimum pour qu'un résultat « Apparence » s'affiche. SigLIP donne des scores bas et resserrés : monte ce seuil pour couper la queue. 0 % affiche tout.",
                })}
              </span>
            </label>
          </div>

          {/* Appearance tags (WD-Tagger → e5): enriches "Sens" with how figures look. */}
          <div className="mt-7 pt-6 border-t border-[var(--color-or)]/15">
            <div className="atelier-toggle-row">
              <div id="vs-tags-label" className="atelier-toggle-row-text">
                <span className={`atelier-toggle-row-state ${appearanceTags ? "is-on" : ""}`}>
                  {appearanceTags
                    ? t("admin.settings.visual.tags_on", {
                        default: "Recherche par apparence (tags) activée",
                      })
                    : t("admin.settings.visual.tags_off", {
                        default: "Recherche par apparence (tags) désactivée",
                      })}
                </span>
                <span className="atelier-toggle-row-hint">
                  {t("admin.settings.visual.tags_hint", {
                    default:
                      "Étiquette chaque image (personnage, cheveux, tenue, « elfe »…) et ajoute ces tags au texte « Sens » : la recherche par le sens trouve alors aussi par apparence. Tourne dans le worker, aucun modèle de plus dans le navigateur. Indexe ci-dessous.",
                  })}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={appearanceTags}
                aria-labelledby="vs-tags-label"
                onClick={() => setAppearanceTagsDraft(!appearanceTags)}
                className={`atelier-toggle ${appearanceTags ? "is-on" : ""}`}
              />
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => reindexTags.mutate()}
                disabled={reindexTags.isPending}
                className="px-3 py-1.5 border border-[var(--color-or)]/30 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 transition-colors disabled:opacity-50"
              >
                {t("admin.settings.visual.tags_reindex", { default: "Indexer l'apparence (tags)" })}
              </button>
              <ForceButton
                t={t}
                busy={reindexTags.isPending}
                onForce={() => reindexTags.mutate({ force: true })}
              />
              {typeof vsStatus.data?.tagged === "number" ? (
                <span className="font-mono text-[11px] text-[var(--color-ivoire-soft)]">
                  {t("admin.settings.visual.tags_indexed", {
                    n: vsStatus.data.tagged,
                    default: `${vsStatus.data.tagged} taguées`,
                  })}
                </span>
              ) : null}
              {reindexTags.isSuccess ? (
                <span className="text-[11px] text-[var(--color-jade)]">
                  {t("admin.settings.visual.text_reindex_done", { default: "File alimentée." })}
                </span>
              ) : null}
            </div>
            {/* Owned-photo tagging — tags the USERS' own uploaded photos so they
                can filter their collection by look. Same WD-Tagger model + flag;
                needs WORKER_INTERNAL_TOKEN set so the worker can fetch the
                private photos. */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => reindexOwnedTags.mutate()}
                disabled={reindexOwnedTags.isPending}
                className="px-3 py-1.5 border border-[var(--color-or)]/30 text-[11px] uppercase tracking-[0.18em] text-[var(--color-or)] hover:bg-[var(--color-or)]/10 transition-colors disabled:opacity-50"
              >
                {t("admin.settings.visual.owned_tags_reindex", {
                  default: "Taguer les photos des collections",
                })}
              </button>
              <ForceButton
                t={t}
                busy={reindexOwnedTags.isPending}
                onForce={() => reindexOwnedTags.mutate({ force: true })}
              />
              {reindexOwnedTags.isSuccess ? (
                <span className="text-[11px] text-[var(--color-jade)]">
                  {t("admin.settings.visual.text_reindex_done", { default: "File alimentée." })}
                </span>
              ) : null}
            </div>
          </div>

          {/* Danger zone — wipe & rebuild every index from scratch */}
          <div className="mt-7 pt-5 border-t border-dashed border-[var(--color-laque)]/25 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-[var(--color-ivoire-soft)]/60 max-w-sm leading-relaxed">
              {t("admin.settings.visual.force_all_hint", {
                default:
                  "Efface tous les index (vecteurs + tags) et relance une indexation complète de zéro.",
              })}
            </p>
            <ForceButton
              t={t}
              busy={reindexAll.isPending}
              onForce={() => reindexAll.mutate()}
              label={t("admin.settings.visual.force_all", {
                default: "Tout réindexer de zéro",
              })}
              confirmLabel={t("admin.settings.visual.force_all_confirm", {
                default: "Confirmer — tout effacer & réindexer",
              })}
            />
          </div>

          {/* Save row */}
          <div className="mt-7 flex items-center justify-end gap-4">
            {updateVs.isSuccess && !vsDirty ? (
              <p
                role="status"
                aria-live="polite"
                className="text-xs tracking-wide text-[var(--color-or)]"
              >
                {t("admin.settings.saved")}
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={saveVs}
              disabled={!vsDirty || updateVs.isPending}
              loading={updateVs.isPending}
            >
              {t("admin.settings.save")}
            </Button>
          </div>
        </Card>
      </div>

      {helpOpen ? (
        <AmbianceHelpModal t={t} onClose={() => setHelpOpen(false)} />
      ) : null}
    </div>
  );
}

// One policy row: a hidden native radio for a11y + keyboard, an A diamond
// marker (hanko-red + glow when active, hairline gold otherwise), and a
// label/description stack. The whole row is the click + focus target.
/** Destructive "from scratch" reindex control. First click ARMS it (turns
 *  laque-red, auto-disarms after 4 s); the second click fires `onForce`. A
 *  deliberate two-step confirm without the weight of a modal, since wiping an
 *  index deletes its vectors/tags before rebuilding. */
function ForceButton({ t, onForce, busy, label, confirmLabel }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      disabled={busy}
      title={t("admin.settings.visual.force_hint", {
        default: "Efface l'index puis relance une indexation complète",
      })}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onForce();
        } else {
          setArmed(true);
        }
      }}
      className={`px-3 py-1.5 border text-[11px] uppercase tracking-[0.18em] transition-colors disabled:opacity-50 ${
        armed
          ? "border-[var(--color-laque)] bg-[var(--color-laque)]/15 text-[var(--color-laque-bright)]"
          : "border-[var(--color-laque)]/30 text-[var(--color-laque-bright)]/70 hover:bg-[var(--color-laque)]/10"
      }`}
    >
      {armed
        ? (confirmLabel ??
          t("admin.settings.visual.force_confirm", { default: "Confirmer — effacer" }))
        : (label ?? t("admin.settings.visual.force", { default: "De zéro" }))}
    </button>
  );
}

/** Modal explaining what an "ambiance" is, in plain language. */
function AmbianceHelpModal({ t, onClose }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("common.got_it", { default: "Compris" })}
        </Button>
      }
    >
      <header className="mb-4">
        <p className="micro flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-[var(--accent)]">
            彩
          </span>
          {t("admin.settings.visual.ambiances_help_eyebrow", { default: "Recherche par photo" })}
        </p>
        <h3 className="display text-2xl text-[var(--on-surface)] mt-1">
          {t("admin.settings.visual.ambiances_help_title", {
            default: "Qu'est-ce qu'une ambiance ?",
          })}
        </h3>
        <div className="gold-rule w-16 mt-3" />
      </header>
      <div className="space-y-3 text-sm leading-relaxed text-[var(--on-surface-muted)]">
        <p>
          {t("admin.settings.visual.ambiances_help_p1", {
            default:
              "Une ambiance regroupe des figurines qui se ressemblent à l'œil — même style, même atmosphère (pose, couleurs, composition) — indépendamment de leur type ou de leur fabricant.",
          })}
        </p>
        <p>
          {t("admin.settings.visual.ambiances_help_p2", {
            default:
              "Le regroupement est calculé à partir des images elles-mêmes (la même empreinte visuelle que la recherche par photo), pas à partir des fiches : deux pièces au rendu proche se retrouvent dans la même ambiance.",
          })}
        </p>
        <p>
          {t("admin.settings.visual.ambiances_help_p3", {
            default:
              "C'est une aide à la découverte : feuilleter sa collection « par atmosphère » plutôt que par catégorie. Ça n'a d'intérêt que sur une collection assez grande et variée — sur un petit catalogue, ou s'il ne contient qu'un seul genre de pièces, les ambiances sont peu parlantes. C'est pourquoi c'est désactivé par défaut.",
          })}
        </p>
      </div>
    </Modal>
  );
}

function PolicyOption({ value, active, label, desc, onSelect }) {
  return (
    <label
      className="group flex items-start gap-4 cursor-pointer p-4 md:p-5 border transition-colors duration-200"
      style={{
        borderColor: active
          ? "var(--color-laque-bright)"
          : "color-mix(in oklab, var(--color-or) 22%, transparent)",
        background: active
          ? "color-mix(in oklab, var(--color-laque) 8%, transparent)"
          : "color-mix(in oklab, var(--color-noir-deep) 50%, transparent)",
      }}
    >
      <input
        type="radio"
        name="gsplat-policy"
        value={value}
        checked={active}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        aria-hidden
        className="mt-1 w-3 h-3 shrink-0 rotate-45 border transition-colors duration-200"
        style={{
          borderColor: active ? "var(--color-laque-bright)" : "var(--color-or)",
          background: active ? "var(--color-laque-bright)" : "transparent",
          boxShadow: active ? "0 0 10px var(--color-laque-bright)" : "none",
          opacity: active ? 1 : 0.5,
        }}
      />
      <span className="min-w-0">
        <span
          className="block text-sm tracking-wide"
          style={{
            color: active ? "var(--color-ivoire)" : "var(--color-ivoire-soft)",
          }}
        >
          {label}
        </span>
        <span className="mt-1 block text-xs text-[var(--color-ivoire-soft)] leading-relaxed">
          {desc}
        </span>
      </span>
    </label>
  );
}
