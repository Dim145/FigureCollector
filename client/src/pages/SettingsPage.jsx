import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useChannels } from "../hooks/useNotifications.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import { useMyStats, useInsights } from "../hooks/useStats.js";
import { useCurrencies } from "../hooks/useCurrencies.js";
import { CURRENCY_LABELS } from "../lib/money.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import NotificationSettings from "../components/NotificationSettings.jsx";
import FxSettings from "../components/FxSettings.jsx";
import MangaSettings from "../components/MangaSettings.jsx";
import Select from "../components/Select.jsx";
import { BG_MODEL_SIZES, getPref, setPref } from "../lib/userPrefs.js";

/**
 * /settings — L'Atelier, redrawn to Direction A ("Shōjo-Noir").
 *
 * An editorial settings ledger rather than a generic form list:
 *   - an editorial header (kicker · 棚 · label → AccentTitle h1 → gold-rule)
 *     over a faint kanji-mark watermark, with a small figurine-metric strip;
 *   - a sticky section index on the left (scroll-spy, hanko-red active marker);
 *   - the settings themselves grouped into clearly-sectioned Card panels, each
 *     introduced by a kanji + kicker sub-label and a gold-rule divider.
 *
 * Sections, top-to-bottom (data + behaviour unchanged from the prior layout):
 *   公 — Profil public      (toggles + sharable URL)
 *   銭 — Devise par défaut  (currency Select + FX)
 *   漫 — MangaCollector     (cross-collection link)
 *   影 — Modèle de détourage (BG removal model size)
 *   鈴 — Notifications       (channels + routing; only if admin-enabled)
 *   禁 — Contenu sensible    (NSFW visibility)
 *   蔵 — Archives            (data export)
 *
 * Direction A keeps gold for value/rules only and hanko-red for the single hot
 * accent (active nav, the accent headline word). GPU-light throughout: flat
 * fills + hairlines, the shared `.reveal` stagger, no animated meshes / blur.
 */

// Section identity: kanji + the nav label key. Order here drives the visual
// order of both the section index and the panels. (Tone fields from the old
// per-section colour-wash are dropped — Direction A keeps the chrome quiet and
// reserves red/gold for accent + value.)
const ALL_SECTIONS = [
  { id: "profile",    kanji: "公" },
  { id: "currency",   kanji: "銭" },
  { id: "manga",      kanji: "漫" },
  { id: "bg_model",   kanji: "影" },
  { id: "notif_chan", kanji: "鈴" },
  { id: "nsfw",       kanji: "禁" },
  { id: "archives",   kanji: "蔵" },
];

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();
  const channels = useChannels();
  // Feed the header metric strip + the Archives panel's per-dataset counts.
  // React-Query-cached, so these are the same figures the rest of the app
  // already fetched; default to 0 while loading / on error.
  const stats = useMyStats();
  const insights = useInsights();
  const currencies = useCurrencies();
  const [bgModel, setBgModel] = useState(() => getPref("bgModel"));
  const [active, setActive] = useState("profile");
  const [copied, setCopied] = useState(false);

  // ALL hooks must run on every render — keep them above any early return
  // so the hook ordering stays stable when auth state changes.
  const panelRefs = useRef({});
  // Hide the Notifications section entirely when the admin hasn't enabled
  // any channel. We can't act on what isn't there, so don't even show
  // the panel / index entry.
  const hasAnyChannel = useMemo(
    () => (channels.data?.system ?? []).some((c) => c.enabled),
    [channels.data],
  );
  const sections = useMemo(
    () => ALL_SECTIONS.filter((s) => s.id !== "notif_chan" || hasAnyChannel),
    [hasAnyChannel],
  );
  useScrollSpy(sections, setActive, panelRefs);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const user = me.data.user;
  const flag =
    update.data?.public_profile_enabled ??
    me.data?.user?.public_profile_enabled ??
    false;
  const showNsfwPublic =
    update.data?.public_profile_show_nsfw ??
    me.data?.user?.public_profile_show_nsfw ??
    false;
  const showValuePublic =
    update.data?.public_profile_show_value ??
    me.data?.user?.public_profile_show_value ??
    false;
  const publicUrl = `${window.location.origin}/u/${user.username}`;

  // Header strip + Archives counts.
  const pieces = stats.data?.total_pieces ?? 0;
  const placedPreorders = stats.data?.preorders?.placed ?? 0;
  const wishes = insights.data?.wishlist_count ?? 0;

  const toggle = () => update.mutate({ public_profile_enabled: !flag });
  const toggleNsfwPublic = () =>
    update.mutate({ public_profile_show_nsfw: !showNsfwPublic });
  const toggleValuePublic = () =>
    update.mutate({ public_profile_show_value: !showValuePublic });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  const onBgModel = (value) => {
    setBgModel(value);
    setPref("bgModel", value);
  };
  const onNavClick = (id) => (e) => {
    e.preventDefault();
    const el = panelRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-16">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-12">
          <span
            aria-hidden
            className="kanji-mark text-[24rem] -top-28 -right-8 hidden md:block select-none"
          >
            棚
          </span>

          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("settings.kicker", { default: "RÉGLAGES" })}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">棚</span>
            {t("settings.kicker_label", { default: "ESPACE PRIVÉ" })}
          </p>
          <h1
            className="display text-6xl md:text-7xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("settings.title")} />
          </h1>
          <div className="gold-rule w-32 mt-6 reveal" style={{ "--i": 2 }} />
          <p
            className="display-italic text-[var(--color-or)] text-lg mt-5 max-w-xl reveal"
            style={{ "--i": 3 }}
          >
            {t("settings.subtitle")}
          </p>
        </header>

        {/* ─── Section index (sticky on lg) + panels ─── */}
        <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12 lg:items-start">
          <SectionIndex
            sections={sections}
            active={active}
            onClick={onNavClick}
            t={t}
          />

          <div className="min-w-0 space-y-8">
            <Panel
              id="profile"
              kanji="公"
              eyebrow={t("settings.nav.profile")}
              title={t("settings.public_profile")}
              refMap={panelRefs}
            >
              <p className="atelier-drawer-desc">
                {t("settings.public_profile.body", { username: user.username })}
              </p>

              <div className="atelier-toggle-row">
                <div id="toggle-label-public-profile" className="atelier-toggle-row-text">
                  <span
                    className={`atelier-toggle-row-state ${flag ? "is-on" : ""}`}
                  >
                    {flag
                      ? t("settings.public_profile.on")
                      : t("settings.public_profile.off")}
                  </span>
                  <span className="atelier-toggle-row-hint">
                    /u/{user.username}
                  </span>
                </div>
                <Toggle on={flag} onChange={toggle} disabled={update.isPending} labelId="toggle-label-public-profile" />
              </div>

              {flag ? (
                <>
                  <div className="atelier-url">
                    <div className="atelier-url-text">
                      <span className="atelier-url-eyebrow">
                        {t("settings.public_profile.url")}
                      </span>
                      <Link to={`/u/${user.username}`} className="atelier-url-link">
                        {publicUrl}
                      </Link>
                    </div>
                    <button
                      type="button"
                      onClick={copy}
                      className="tap-target shrink-0 px-3 text-[10px] uppercase tracking-[0.2em] border transition-colors"
                      style={{
                        color: copied ? "var(--color-noir)" : "var(--color-or-pale)",
                        background: copied
                          ? "var(--color-or)"
                          : "transparent",
                        borderColor: "color-mix(in oklab, var(--color-or) 40%, transparent)",
                      }}
                    >
                      {copied
                        ? t("settings.copy_url.done")
                        : t("settings.copy_url")}
                    </button>
                  </div>

                  {/* Sub-toggle — only relevant once the profile is opened
                    * to the public. Keeps NSFW pieces out of the public view
                    * by default (the conservative choice). */}
                  <p className="atelier-drawer-desc" style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>
                    {t("settings.public_profile.show_nsfw.body")}
                  </p>
                  <div className="atelier-toggle-row">
                    <div id="toggle-label-show-nsfw" className="atelier-toggle-row-text">
                      <span
                        className={`atelier-toggle-row-state ${showNsfwPublic ? "is-on" : ""}`}
                      >
                        {showNsfwPublic
                          ? t("settings.public_profile.show_nsfw.on")
                          : t("settings.public_profile.show_nsfw.off")}
                      </span>
                      <span className="atelier-toggle-row-hint">
                        {t("settings.public_profile.show_nsfw")}
                      </span>
                    </div>
                    <Toggle
                      on={showNsfwPublic}
                      onChange={toggleNsfwPublic}
                      disabled={update.isPending}
                      labelId="toggle-label-show-nsfw"
                    />
                  </div>

                  {/* Sub-toggle — expose the collection's value (La Cote) on
                    * the public profile / discovery card. OFF by default so a
                    * public profile never leaks value unintentionally. */}
                  <p className="atelier-drawer-desc" style={{ marginTop: "1.5rem", marginBottom: "0.75rem" }}>
                    {t("settings.public_profile.show_value.body")}
                  </p>
                  <div className="atelier-toggle-row">
                    <div id="toggle-label-show-value" className="atelier-toggle-row-text">
                      <span
                        className={`atelier-toggle-row-state ${showValuePublic ? "is-on" : ""}`}
                      >
                        {showValuePublic
                          ? t("settings.public_profile.show_value.on")
                          : t("settings.public_profile.show_value.off")}
                      </span>
                      <span className="atelier-toggle-row-hint">
                        {t("settings.public_profile.show_value")}
                      </span>
                    </div>
                    <Toggle
                      on={showValuePublic}
                      onChange={toggleValuePublic}
                      disabled={update.isPending}
                      labelId="toggle-label-show-value"
                    />
                  </div>
                </>
              ) : null}
            </Panel>

            <Panel
              id="currency"
              kanji="銭"
              eyebrow={t("settings.nav.currency")}
              title={t("settings.currency.title")}
              refMap={panelRefs}
            >
              <p className="atelier-drawer-desc">{t("settings.currency.body")}</p>
              <div className="atelier-select-wrap">
                <Select
                  label={t("settings.currency.field")}
                  value={
                    update.data?.preferred_currency ??
                    user.preferred_currency ??
                    ""
                  }
                  onChange={(v) =>
                    update.mutate({ preferred_currency: v === "" ? "" : v })
                  }
                  options={[
                    { value: "", label: t("settings.currency.none") },
                    ...currencies.map((c) => ({
                      value: c,
                      label: CURRENCY_LABELS[c] || c,
                    })),
                  ]}
                />
              </div>
              <p className="atelier-select-hint">{t("settings.currency.hint")}</p>
              <FxSettings />
            </Panel>

            <Panel
              id="manga"
              kanji="漫"
              eyebrow={t("settings.nav.manga")}
              title={t("settings.manga.title")}
              refMap={panelRefs}
            >
              <MangaSettings />
            </Panel>

            <Panel
              id="bg_model"
              kanji="影"
              eyebrow={t("settings.nav.bg_model")}
              title={t("settings.bg_model")}
              refMap={panelRefs}
            >
              <p className="atelier-drawer-desc">{t("settings.bg_model.body")}</p>
              <div className="atelier-select-wrap">
                <Select
                  label={t("settings.bg_model")}
                  value={bgModel}
                  onChange={onBgModel}
                  options={BG_MODEL_SIZES.map((size) => ({
                    value: size,
                    label: t(`settings.bg_model.${size}`),
                  }))}
                />
              </div>
              <p className="atelier-select-hint">{t("settings.bg_model.hint")}</p>
            </Panel>

            {/* Notifications — only rendered when the admin has enabled
              * at least one channel. Otherwise the entire section vanishes
              * (the index entry is also filtered out, see `sections`). */}
            {hasAnyChannel ? (
              <Panel
                id="notif_chan"
                kanji="鈴"
                eyebrow={t("settings.nav.notif_chan")}
                title={t("notif.channels.title")}
                refMap={panelRefs}
              >
                <NotificationSettings t={t} />
              </Panel>
            ) : null}

            <Panel
              id="nsfw"
              kanji="禁"
              eyebrow={t("settings.nav.nsfw")}
              title={t("settings.nsfw.title")}
              refMap={panelRefs}
            >
              <p className="atelier-drawer-desc">{t("settings.nsfw.body")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {NSFW_OPTIONS.map(({ key, kanji }) => {
                  const current =
                    update.data?.nsfw_visibility ??
                    user.nsfw_visibility ??
                    "hide";
                  const isActive = current === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update.mutate({ nsfw_visibility: key })}
                      disabled={update.isPending}
                      aria-pressed={isActive}
                      className="relative text-left p-4 border transition-colors disabled:opacity-60 disabled:cursor-wait"
                      style={{
                        borderColor: isActive
                          ? "var(--color-laque-bright)"
                          : "color-mix(in oklab, var(--color-or) 20%, transparent)",
                        background: isActive
                          ? "color-mix(in oklab, var(--color-laque) 12%, transparent)"
                          : "color-mix(in oklab, var(--color-noir-deep) 50%, transparent)",
                      }}
                    >
                      <span
                        className="ja block text-2xl leading-none mb-2"
                        aria-hidden
                        style={{
                          color: isActive
                            ? "var(--color-laque-bright)"
                            : "var(--color-or)",
                          opacity: isActive ? 1 : 0.7,
                        }}
                      >
                        {kanji}
                      </span>
                      <span className="display text-lg text-[var(--color-ivoire)] block leading-tight">
                        {t(`settings.nsfw.${key}.title`)}
                      </span>
                      <span className="block mt-1.5 text-[12px] leading-relaxed text-[var(--color-ivoire-soft)]">
                        {t(`settings.nsfw.${key}.body`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            {/* Archives — data export (relocated from the standalone /archives
              * page). Each dataset downloads as CSV (spreadsheet) or JSON
              * (faithful backup); the dashed footer bundles everything into one
              * re-importable JSON snapshot. */}
            <Panel
              id="archives"
              kanji="蔵"
              eyebrow={t("settings.nav.archives")}
              title={t("archives.title")}
              refMap={panelRefs}
            >
              <p className="atelier-drawer-desc">{t("archives.subtitle")}</p>
              <div className="exp-grid">
                <ExportCard
                  kanji="蒐"
                  title={t("archives.collection")}
                  count={pieces}
                  countLabel={t("archives.count.pieces")}
                  cols={t("archives.cols.collection")}
                  base="collection"
                  t={t}
                />
                <ExportCard
                  kanji="望"
                  title={t("archives.wishlist")}
                  count={wishes}
                  countLabel={t("archives.count.wishes")}
                  cols={t("archives.cols.wishlist")}
                  base="wishlist"
                  t={t}
                />
                <ExportCard
                  kanji="予"
                  title={t("archives.preorders")}
                  count={placedPreorders}
                  countLabel={t("archives.count.preorders")}
                  cols={t("archives.cols.preorders")}
                  base="preorders"
                  t={t}
                />
              </div>
              <div className="exp-backup">
                <p>
                  <b>{t("archives.backup.title")}</b> — {t("archives.backup.body")}
                </p>
                <a
                  href="/api/me/export/backup.json"
                  download
                  className="dl-btn dl-btn--json"
                >
                  ↓ {t("archives.backup.download")}
                </a>
              </div>
            </Panel>
          </div>
        </div>

      </main>
    </AppShell>
  );
}

// One dataset's export card inside the Archives panel. Downloads are plain
// authenticated <a> links — the session cookie rides along and the server
// replies with Content-Disposition: attachment.
function ExportCard({ kanji, title, count, countLabel, cols, base, t }) {
  return (
    <article className="exp-card">
      <span className="exp-card-kanji" aria-hidden>
        {kanji}
      </span>
      <div className="exp-card-title">{title}</div>
      <div className="exp-card-count">
        <b>{count}</b>
        <span>{countLabel}</span>
      </div>
      <p className="exp-card-cols">
        <span className="exp-card-cols-label">{t("archives.columns")}</span>
        {cols}
      </p>
      <div className="exp-card-dls">
        <a
          href={`/api/me/export/${base}.csv`}
          download
          className="dl-btn dl-btn--csv"
        >
          ↓ CSV
        </a>
        <a
          href={`/api/me/export/${base}.json`}
          download
          className="dl-btn dl-btn--json"
        >
          ↓ JSON
        </a>
      </div>
    </article>
  );
}

// NSFW choices, each with its own kanji glyph driving the visual identity
// of the button (覆 cover, 霞 mist/blur, 開 open).
const NSFW_OPTIONS = [
  { key: "hide", kanji: "覆" },
  { key: "blur", kanji: "霞" },
  { key: "show", kanji: "開" },
];

// =============================================================================
// Section index — sticky on desktop, horizontal chip strip on mobile
// =============================================================================

function SectionIndex({ sections, active, onClick, t }) {
  return (
    <nav
      className="lg:sticky lg:top-24 mb-8 lg:mb-0"
      aria-label={t("settings.nav.heading")}
    >
      <p className="micro pb-3 mb-2 border-b border-[var(--color-or)]/20 hidden lg:block">
        {t("settings.nav.heading")}
      </p>
      <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
        {sections.map((s, i) => {
          const isActive = active === s.id;
          return (
            <li key={s.id} className="reveal shrink-0 lg:shrink" style={{ "--i": i }}>
              <a
                href={`#${s.id}`}
                onClick={onClick(s.id)}
                aria-current={isActive ? "true" : undefined}
                className="tap-target group flex items-center gap-2.5 whitespace-nowrap px-3 lg:px-0 lg:py-2.5 lg:border-l-2 transition-colors"
                style={{
                  borderLeftColor: isActive
                    ? "var(--color-laque-bright)"
                    : "transparent",
                  color: isActive
                    ? "var(--color-ivoire)"
                    : "var(--color-ivoire-soft)",
                }}
              >
                <span
                  className="ja text-base leading-none transition-colors"
                  aria-hidden
                  style={{
                    color: isActive
                      ? "var(--color-laque-bright)"
                      : "var(--color-or)",
                    opacity: isActive ? 1 : 0.55,
                  }}
                >
                  {s.kanji}
                </span>
                <span className="text-sm group-hover:text-[var(--color-ivoire)]">
                  {t(`settings.nav.${s.id}`)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// =============================================================================
// Panel — one setting section, as a Direction-A Card with an editorial header
// =============================================================================

function Panel({ id, kanji, eyebrow, title, refMap, children }) {
  return (
    <Card
      as="section"
      className="relative overflow-hidden p-6 md:p-8"
    >
      {/* Calm kanji watermark — gold, very faint, bleeding off the corner.
          Static, pointer-inert: GPU-free atmosphere. */}
      <span
        aria-hidden
        className="kanji-mark text-[11rem] -top-10 -right-4 select-none"
      >
        {kanji}
      </span>

      {/* `id` + scroll-margin live on the header (Card doesn't forward `id`),
          so `#id` deep-links, the scroll-spy, and scrollIntoView all target
          the same node. `relative` lifts it above the clipped watermark. */}
      <header
        id={id}
        className="relative mb-6 scroll-mt-24"
        ref={(el) => {
          if (el) refMap.current[id] = el;
        }}
      >
        <p className="micro flex items-center gap-2">
          <span className="ja not-italic text-base text-[var(--color-or)] leading-none" aria-hidden>
            {kanji}
          </span>
          {eyebrow}
        </p>
        <h2 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)] leading-tight">
          {title}
        </h2>
        <div className="gold-rule w-16 mt-4" />
      </header>
      <div className="relative">{children}</div>
    </Card>
  );
}

function Toggle({ on, onChange, disabled, labelId }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelId}
      onClick={onChange}
      disabled={disabled}
      className={`atelier-toggle ${on ? "is-on" : ""}`}
    />
  );
}

// =============================================================================
// Scroll spy — highlights the index link of the section currently in view
// =============================================================================

function useScrollSpy(sections, setActive, refMap) {
  useEffect(() => {
    // Plain scroll listener — simpler than IntersectionObserver and
    // doesn't have timing issues around when refs become available. The
    // active section is the LAST one whose top has scrolled above a
    // line set ~25% from the viewport top.
    function onScroll() {
      const triggerY = window.innerHeight * 0.25;
      let candidate = null;
      for (const s of sections) {
        const el = refMap.current[s.id];
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= triggerY) candidate = s.id;
      }
      // Default to the first section when nothing is yet above the line
      // (e.g. at the very top of the page).
      setActive(candidate ?? sections[0].id);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [sections, setActive, refMap]);
}
