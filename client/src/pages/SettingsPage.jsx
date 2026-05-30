import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useChannels } from "../hooks/useNotifications.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import { useMyStats, useInsights } from "../hooks/useStats.js";
import AppShell from "../components/AppShell.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import NotificationSettings from "../components/NotificationSettings.jsx";
import Select from "../components/Select.jsx";
import { BG_MODEL_SIZES, getPref, setPref } from "../lib/userPrefs.js";

/**
 * /settings — L'Atelier (the curator's workshop).
 *
 * Two-column layout on desktop: a sticky kanji-stamped nav rail on the left,
 * stacked drawer sections on the right. Each drawer carries a giant kanji
 * watermark in its accent colour (gold / jade / laque) and a calligraphic
 * title. Mobile flips the rail into a horizontal chip strip pinned below
 * the page header.
 *
 * Sections, top-to-bottom:
 *   公 — Profil public      (toggle + sharable URL, gold)
 *   銭 — Devise par défaut  (currency select, gold)
 *   影 — Modèle de détourage (BG removal model size, jade)
 *   禁 — Contenu sensible    (NSFW visibility, laque red)
 *
 * Scroll-spy: as the user scrolls, the active section in the nav rail
 * lights up. Clicking a nav link smooth-scrolls the target drawer into
 * view with a top offset that clears the AppShell's sticky header.
 */

// Each section's identity: kanji + the accent colour for highlight + the
// nav label key. Order here drives the visual order of both the nav and
// the drawers.
/// All possible drawers. The Notifications drawer is excluded at render
/// time when the admin has zero channels enabled — see `sections` below.
const ALL_SECTIONS = [
  { id: "profile",    kanji: "公", tone: "var(--color-or)",       toneSoft: "color-mix(in oklab, var(--color-or) 18%, transparent)" },
  { id: "currency",   kanji: "銭", tone: "var(--color-or)",       toneSoft: "color-mix(in oklab, var(--color-or) 18%, transparent)" },
  { id: "bg_model",   kanji: "影", tone: "var(--atelier-jade)",   toneSoft: "var(--atelier-jade-soft)" },
  { id: "notif_chan", kanji: "鈴", tone: "var(--color-or)",       toneSoft: "color-mix(in oklab, var(--color-or) 18%, transparent)" },
  { id: "nsfw",       kanji: "禁", tone: "var(--atelier-laque)",  toneSoft: "var(--atelier-laque-soft)" },
  { id: "archives",   kanji: "蔵", tone: "var(--color-or)",       toneSoft: "color-mix(in oklab, var(--color-or) 18%, transparent)" },
];

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();
  const channels = useChannels();
  // Feed the Archives drawer's per-dataset counts. React-Query-cached, so
  // the figures shown there are the same ones the rest of the app already
  // fetched; default to 0 while loading / on error.
  const stats = useMyStats();
  const insights = useInsights();
  const [bgModel, setBgModel] = useState(() => getPref("bgModel"));
  const [active, setActive] = useState("profile");
  const [copied, setCopied] = useState(false);

  // ALL hooks must run on every render — keep them above any early return
  // so the hook ordering stays stable when auth state changes.
  const drawerRefs = useRef({});
  // Hide the Notifications section entirely when the admin hasn't enabled
  // any channel. We can't act on what isn't there, so don't even show
  // the drawer / nav entry.
  const hasAnyChannel = useMemo(
    () => (channels.data?.system ?? []).some((c) => c.enabled),
    [channels.data],
  );
  const sections = useMemo(
    () => ALL_SECTIONS.filter((s) => s.id !== "notif_chan" || hasAnyChannel),
    [hasAnyChannel],
  );
  useScrollSpy(sections, setActive, drawerRefs);

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

  // Archives drawer counts.
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
    const el = drawerRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Stable tone lookup by section id — the filtered `sections` array shifts
  // indices when notif_chan is hidden, so we resolve from ALL_SECTIONS.
  const toneOf = (id) => ALL_SECTIONS.find((s) => s.id === id) ?? ALL_SECTIONS[0];

  return (
    <AppShell>
      <main className="atelier max-w-6xl mx-auto px-6 pt-4 pb-20">
        <Hero username={user.username} t={t} />

        <Nav sections={sections} active={active} onClick={onNavClick} t={t} />

        <div className="atelier-content">
          {/* Public profile */}
          <Drawer
            id="profile"
            kanji="公"
            title={t("settings.public_profile")}
            tone={toneOf("profile").tone}
            toneSoft={toneOf("profile").toneSoft}
            delay={0}
            refMap={drawerRefs}
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
                    className={`atelier-url-copy ${copied ? "is-done" : ""}`}
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
          </Drawer>

          {/* Currency */}
          <Drawer
            id="currency"
            kanji="銭"
            title={t("settings.currency.title")}
            tone={toneOf("currency").tone}
            toneSoft={toneOf("currency").toneSoft}
            delay={0.06}
            refMap={drawerRefs}
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
                  { value: "JPY", label: "JPY · Yen" },
                  { value: "EUR", label: "EUR · Euro" },
                  { value: "USD", label: "USD · US Dollar" },
                  { value: "GBP", label: "GBP · British Pound" },
                  { value: "CHF", label: "CHF · Swiss Franc" },
                  { value: "CAD", label: "CAD · Canadian Dollar" },
                ]}
              />
            </div>
            <p className="atelier-select-hint">{t("settings.currency.hint")}</p>
          </Drawer>

          {/* BG model */}
          <Drawer
            id="bg_model"
            kanji="影"
            title={t("settings.bg_model")}
            tone={toneOf("bg_model").tone}
            toneSoft={toneOf("bg_model").toneSoft}
            delay={0.12}
            refMap={drawerRefs}
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
          </Drawer>

          {/* Notifications — only rendered when the admin has enabled
            * at least one channel. Otherwise the entire section vanishes
            * (the nav entry is also filtered out, see `sections`). */}
          {hasAnyChannel ? (
            <Drawer
              id="notif_chan"
              kanji="鈴"
              title={t("notif.channels.title")}
              tone={toneOf("notif_chan").tone}
              toneSoft={toneOf("notif_chan").toneSoft}
              delay={0.18}
              refMap={drawerRefs}
            >
              <NotificationSettings t={t} />
            </Drawer>
          ) : null}

          {/* NSFW visibility */}
          <Drawer
            id="nsfw"
            kanji="禁"
            title={t("settings.nsfw.title")}
            tone={toneOf("nsfw").tone}
            toneSoft={toneOf("nsfw").toneSoft}
            delay={0.18}
            refMap={drawerRefs}
          >
            <p className="atelier-drawer-desc">{t("settings.nsfw.body")}</p>
            <div className="atelier-nsfw-grid">
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
                    className={`atelier-nsfw-btn ${isActive ? "is-active" : ""}`}
                  >
                    <span className="atelier-nsfw-btn-kanji" aria-hidden>
                      {kanji}
                    </span>
                    <span className="atelier-nsfw-btn-title">
                      {t(`settings.nsfw.${key}.title`)}
                    </span>
                    <span className="atelier-nsfw-btn-desc">
                      {t(`settings.nsfw.${key}.body`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Drawer>

          {/* Archives — data export (relocated from the standalone /archives
            * page). Each dataset downloads as CSV (spreadsheet) or JSON
            * (faithful backup); the dashed footer bar bundles everything into
            * one re-importable JSON snapshot. */}
          <Drawer
            id="archives"
            kanji="蔵"
            title={t("archives.title")}
            tone={toneOf("archives").tone}
            toneSoft={toneOf("archives").toneSoft}
            delay={0.24}
            refMap={drawerRefs}
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
          </Drawer>
        </div>
      </main>
    </AppShell>
  );
}

// One dataset's export card inside the Archives drawer. Downloads are plain
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
// Hero
// =============================================================================

function Hero({ username, t }) {
  const reduce = useReducedMotion();
  return (
    <header className="atelier-hero">
      {/* Localized colour-wash — gold + jade + indigo breathing behind the
        * title. Absolutely positioned, never intercepts pointer events, and
        * pinned below the z-index:1 hero content. Reads on both themes
        * because it mixes the theme-aware accent vars into transparent. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 bottom-0"
        style={{
          zIndex: 0,
          backgroundImage: [
            "radial-gradient(46% 70% at 50% 8%, color-mix(in oklab, var(--color-or) 16%, transparent), transparent 70%)",
            "radial-gradient(40% 80% at 16% 36%, color-mix(in oklab, var(--atelier-jade) 14%, transparent), transparent 72%)",
            "radial-gradient(42% 80% at 84% 30%, color-mix(in oklab, var(--color-indigo) 13%, transparent), transparent 72%)",
          ].join(", "),
        }}
      />
      <motion.p
        className="atelier-hero-eyebrow"
        style={{ color: "var(--color-jade)" }}
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        {username}
      </motion.p>
      <motion.h1
        className="atelier-hero-title"
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
      >
        {t("settings.title")}
      </motion.h1>
      <motion.p
        className="atelier-hero-sub"
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      >
        {t("settings.subtitle")}
      </motion.p>
    </header>
  );
}

// =============================================================================
// Sticky nav rail (desktop) / chip strip (mobile)
// =============================================================================

function Nav({ sections, active, onClick, t }) {
  return (
    <nav className="atelier-nav" aria-label={t("settings.title")}>
      <p
        className="atelier-nav-heading"
        style={{
          color: "var(--color-jade)",
          borderBottomColor:
            "color-mix(in oklab, var(--color-jade) 26%, transparent)",
        }}
      >
        {t("settings.nav.heading")}
      </p>
      <ul className="atelier-nav-list">
        {sections.map((s, i) => (
          <Reveal
            as="li"
            key={s.id}
            className="atelier-nav-item"
            delay={i * 0.05}
            y={12}
          >
            <a
              href={`#${s.id}`}
              onClick={onClick(s.id)}
              className={`atelier-nav-link ${active === s.id ? "is-active" : ""}`}
              style={
                active === s.id
                  ? {
                      color: s.tone,
                      borderLeftColor: s.tone,
                    }
                  : undefined
              }
            >
              <span
                className="atelier-nav-link-kanji"
                aria-hidden
                style={active === s.id ? { color: s.tone, opacity: 1 } : undefined}
              >
                {s.kanji}
              </span>
              <span>{t(`settings.nav.${s.id}`)}</span>
            </a>
          </Reveal>
        ))}
      </ul>
    </nav>
  );
}

// =============================================================================
// Drawer — one setting section
// =============================================================================

function Drawer({ id, kanji, title, tone, toneSoft, delay = 0, refMap, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      id={id}
      ref={(el) => {
        if (el) refMap.current[id] = el;
      }}
      className="atelier-drawer group"
      data-kanji={kanji}
      style={{ "--atelier-tone": tone, "--atelier-tone-soft": toneSoft }}
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.18 }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Per-section accent colour-wash — bleeds the drawer's tone up from
        * the corner. Clipped by the drawer's overflow:hidden, sits beneath
        * the z-index:1 body, and warms on hover (opacity only → GPU-safe). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          zIndex: 0,
          backgroundImage:
            "radial-gradient(70% 60% at 88% -10%, color-mix(in oklab, var(--atelier-tone) 14%, transparent), transparent 62%)",
        }}
      />
      <header className="atelier-drawer-header">
        <span
          className="atelier-drawer-kanji"
          aria-hidden
          style={{ color: tone }}
        >
          {kanji}
        </span>
        <h2 className="atelier-drawer-title">{title}</h2>
        <span className="atelier-drawer-rule" aria-hidden />
      </header>
      <div className="atelier-drawer-body">{children}</div>
    </motion.section>
  );
}

// =============================================================================
// Toggle
// =============================================================================

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
// Scroll spy — highlights the nav link of the section currently in view
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
