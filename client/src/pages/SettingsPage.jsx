import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
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
const SECTIONS = [
  { id: "profile",   kanji: "公", tone: "var(--color-or)",          toneSoft: "oklch(0.78 0.10 80 / 0.18)" },
  { id: "currency",  kanji: "銭", tone: "var(--color-or)",          toneSoft: "oklch(0.78 0.10 80 / 0.18)" },
  { id: "bg_model",  kanji: "影", tone: "var(--atelier-jade)",      toneSoft: "var(--atelier-jade-soft)" },
  { id: "nsfw",      kanji: "禁", tone: "var(--atelier-laque)",     toneSoft: "var(--atelier-laque-soft)" },
];

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const update = useUpdateProfile();
  const [bgModel, setBgModel] = useState(() => getPref("bgModel"));
  const [active, setActive] = useState("profile");
  const [copied, setCopied] = useState(false);

  // ALL hooks must run on every render — keep them above any early return
  // so the hook ordering stays stable when auth state changes.
  const drawerRefs = useRef({});
  useScrollSpy(SECTIONS, setActive, drawerRefs);

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
  const publicUrl = `${window.location.origin}/u/${user.username}`;

  const toggle = () => update.mutate({ public_profile_enabled: !flag });
  const toggleNsfwPublic = () =>
    update.mutate({ public_profile_show_nsfw: !showNsfwPublic });
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

  return (
    <AppShell>
      <main className="atelier max-w-6xl mx-auto px-6 pt-4 pb-20">
        <Hero username={user.username} t={t} />

        <Nav active={active} onClick={onNavClick} t={t} />

        <div className="atelier-content">
          {/* Public profile */}
          <Drawer
            id="profile"
            kanji="公"
            title={t("settings.public_profile")}
            tone={SECTIONS[0].tone}
            toneSoft={SECTIONS[0].toneSoft}
            refMap={drawerRefs}
          >
            <p className="atelier-drawer-desc">
              {t("settings.public_profile.body", { username: user.username })}
            </p>

            <div className="atelier-toggle-row">
              <div className="atelier-toggle-row-text">
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
              <Toggle on={flag} onChange={toggle} disabled={update.isPending} />
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
                  <div className="atelier-toggle-row-text">
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
            tone={SECTIONS[1].tone}
            toneSoft={SECTIONS[1].toneSoft}
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
            tone={SECTIONS[2].tone}
            toneSoft={SECTIONS[2].toneSoft}
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

          {/* NSFW visibility */}
          <Drawer
            id="nsfw"
            kanji="禁"
            title={t("settings.nsfw.title")}
            tone={SECTIONS[3].tone}
            toneSoft={SECTIONS[3].toneSoft}
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
        </div>
      </main>
    </AppShell>
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
  return (
    <header className="atelier-hero">
      <p className="atelier-hero-eyebrow">{username}</p>
      <h1 className="atelier-hero-title">{t("settings.title")}</h1>
      <p className="atelier-hero-sub">{t("settings.subtitle")}</p>
    </header>
  );
}

// =============================================================================
// Sticky nav rail (desktop) / chip strip (mobile)
// =============================================================================

function Nav({ active, onClick, t }) {
  return (
    <nav className="atelier-nav" aria-label={t("settings.title")}>
      <p className="atelier-nav-heading">{t("settings.nav.heading")}</p>
      <ul className="atelier-nav-list">
        {SECTIONS.map((s) => (
          <li key={s.id} className="atelier-nav-item">
            <a
              href={`#${s.id}`}
              onClick={onClick(s.id)}
              className={`atelier-nav-link ${active === s.id ? "is-active" : ""}`}
            >
              <span className="atelier-nav-link-kanji" aria-hidden>
                {s.kanji}
              </span>
              <span>{t(`settings.nav.${s.id}`)}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// =============================================================================
// Drawer — one setting section
// =============================================================================

function Drawer({ id, kanji, title, tone, toneSoft, refMap, children }) {
  return (
    <section
      id={id}
      ref={(el) => {
        if (el) refMap.current[id] = el;
      }}
      className="atelier-drawer"
      data-kanji={kanji}
      style={{ "--atelier-tone": tone, "--atelier-tone-soft": toneSoft }}
    >
      <header className="atelier-drawer-header">
        <span className="atelier-drawer-kanji" aria-hidden>{kanji}</span>
        <h2 className="atelier-drawer-title">{title}</h2>
        <span className="atelier-drawer-rule" aria-hidden />
      </header>
      <div className="atelier-drawer-body">{children}</div>
    </section>
  );
}

// =============================================================================
// Toggle
// =============================================================================

function Toggle({ on, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
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
