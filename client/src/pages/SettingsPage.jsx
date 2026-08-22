import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useChannels } from "../hooks/useNotifications.js";
import { useUpdateProfile } from "../hooks/useProfile.js";
import { useCurrencies } from "../hooks/useCurrencies.js";
import { CURRENCY_LABELS } from "../lib/money.js";
import { BG_MODEL_SIZES, getPref, setPref } from "../lib/userPrefs.js";

import AppShell from "../components/AppShell.jsx";
import { PageLayout } from "../components/layout/index.js";
import Select from "../components/Select.jsx";
import FxSettings from "../components/FxSettings.jsx";
import MangaSettings from "../components/MangaSettings.jsx";
import NotificationSettings from "../components/NotificationSettings.jsx";
import EmptyState from "../components/EmptyState.jsx";

import SettingsNav from "./settings/SettingsNav.jsx";
import SettingsPanel from "./settings/SettingsPanel.jsx";
import ProfilePanel from "./settings/ProfilePanel.jsx";
import PrivacyPanel from "./settings/PrivacyPanel.jsx";
import ArchivesPanel from "./settings/ArchivesPanel.jsx";

/**
 * /settings — 棚 L'Atelier, rebuilt on the shared foundation (Direction A,
 * "Shōjo-Noir"). The previous ~700-line page is decomposed into a thin
 * orchestrator (this file: data hooks + section model + scroll-spy + layout)
 * over focused page-local panels in `./settings/`.
 *
 * Layout: <PageLayout> editorial header (棚) → two-column
 * `lg:grid-cols-[15rem_1fr]` — a section index (sticky rail on desktop, sticky
 * Tabs on mobile) beside stacked panels:
 *
 *   公 Profil          — account identity + display-name
 *   銭 Devise          — display currency + FX (FxSettings)
 *   漫 Manga           — MangaCollector cross-link (MangaSettings)
 *   影 Arrière-plan    — background-removal model size
 *   鈴 Notifications   — channels + routing (NotificationSettings)
 *   禁 Confidentialité — public profile + NSFW visibility (PrivacyPanel)
 *   蔵 Archives        — exports + insurance dossier (ArchivesPanel)
 *
 * Each panel owns its own save (per-field mutation / Switch) — there is no
 * single global CTA. GPU-light throughout: flat fills, hairlines, the shared
 * `.reveal` stagger, no animated backgrounds or blur.
 */

// Section model: id + kanji marker. Order drives both the index and the panel
// stack. The Notifications entry is always present now — when the admin has
// enabled no channel the panel shows a quiet note rather than vanishing.
const SECTIONS = [
  { id: "profile", kanji: "公", labelKey: "settings.nav.profile" },
  { id: "currency", kanji: "銭", labelKey: "settings.nav.currency" },
  { id: "manga", kanji: "漫", labelKey: "settings.nav.manga" },
  { id: "bg_model", kanji: "影", labelKey: "settings.nav.bg_model" },
  { id: "notif", kanji: "鈴", labelKey: "settings.nav.notif_chan" },
  { id: "privacy", kanji: "禁", labelKey: "settings.nav.privacy", labelDefault: "Confidentialité" },
  { id: "archives", kanji: "蔵", labelKey: "settings.nav.archives" },
];

export default function SettingsPage() {
  const t = useT();
  const me = useMe();
  const location = useLocation();
  const update = useUpdateProfile();
  const channels = useChannels();
  const currencies = useCurrencies();

  const [bgModel, setBgModel] = useState(() => getPref("bgModel"));
  const [active, setActive] = useState(SECTIONS[0].id);

  // Panel <header> nodes, keyed by section id — drives scroll-spy +
  // scroll-into-view. A callback passed to each panel registers its node.
  const panelRefs = useRef({});
  const registerRef = useMemo(
    () => (id, el) => {
      if (el) panelRefs.current[id] = el;
      else delete panelRefs.current[id];
    },
    [],
  );

  const sections = useMemo(
    () =>
      SECTIONS.map((s) => ({
        ...s,
        label: t(s.labelKey, s.labelDefault ? { default: s.labelDefault } : undefined),
      })),
    [t],
  );

  useScrollSpy(SECTIONS, setActive, panelRefs);

  // Deep-link support: arriving at /settings#privacy (e.g. from the NSFW
  // interstitial's "Modifier ma préférence") selects + scrolls to that panel.
  // Gated on auth because the panels — and thus their registered refs — only
  // mount once signed in; a rAF defers the scroll until the target panel has
  // registered its ref for this hash.
  const deepLinkTarget = me.data?.authenticated ? location.hash.replace(/^#/, "") : "";
  useEffect(() => {
    if (!deepLinkTarget || !SECTIONS.some((s) => s.id === deepLinkTarget)) return;
    setActive(deepLinkTarget);
    // Panels register their refs during the commit that precedes this effect,
    // so the target exists now — jump straight to it. No rAF: a backgrounded
    // tab defers rAF indefinitely, and an anchor arrival is conventionally an
    // instant jump rather than an animated scroll.
    panelRefs.current[deepLinkTarget]?.scrollIntoView({ block: "start" });
  }, [deepLinkTarget]);

  // Hooks must all run before any early return so ordering stays stable.
  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const user = me.data.user;
  const hasAnyChannel = (channels.data?.system ?? []).some((c) => c.enabled);

  const onSelect = (id) => {
    setActive(id);
    const el = panelRefs.current[id];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onBgModel = (value) => {
    setBgModel(value);
    setPref("bgModel", value);
  };

  return (
    <AppShell>
      <PageLayout
        kicker={
          <span className="inline-flex items-center gap-2.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--primary)] rotate-45" />
            {t("settings.kicker", { default: "RÉGLAGES" })}
            <span aria-hidden className="ja not-italic text-[var(--accent)]">
              棚
            </span>
            {t("settings.kicker_label", { default: "ESPACE PRIVÉ" })}
          </span>
        }
        title={t("settings.title")}
        kanji="棚"
      >
        <p className="display-italic text-[var(--accent)] text-lg -mt-4 mb-2 max-w-xl">
          {t("settings.subtitle")}
        </p>

        <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-12 lg:items-start">
          <SettingsNav
            sections={sections}
            active={active}
            onSelect={onSelect}
            heading={t("settings.nav.heading")}
          />

          <div className="min-w-0 space-y-8 mt-6 lg:mt-0">
            <ProfilePanel user={user} registerRef={registerRef} />

            {/* 銭 Devise — display currency + FX. */}
            <SettingsPanel
              id="currency"
              kanji="銭"
              eyebrow={t("settings.nav.currency")}
              title={t("settings.currency.title")}
              registerRef={registerRef}
            >
              <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
                {t("settings.currency.body")}
              </p>
              <div className="max-w-sm mt-4">
                <Select
                  label={t("settings.currency.field")}
                  value={update.data?.preferred_currency ?? user.preferred_currency ?? ""}
                  onChange={(v) => update.mutate({ preferred_currency: v })}
                  hint={t("settings.currency.hint")}
                  options={[
                    { value: "", label: t("settings.currency.none") },
                    ...currencies.map((c) => ({
                      value: c,
                      label: CURRENCY_LABELS[c] || c,
                    })),
                  ]}
                />
              </div>
              {/* Monthly pre-order ceiling — the line the cashflow plan on
                  /collection/preorders draws against. Empty = no ceiling,
                  which is not the same as a ceiling of zero. */}
              <div className="max-w-sm mt-6">
                <label htmlFor="monthly-budget" className="micro block mb-2">
                  {t("settings.budget.field", { default: "Plafond mensuel de précommandes" })}
                </label>
                <input
                  id="monthly-budget"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  defaultValue={user.monthly_budget_amount ?? ""}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === "") {
                      update.mutate({ monthly_budget_clear: true });
                    } else {
                      const n = Number(raw);
                      if (Number.isFinite(n) && n >= 0) {
                        update.mutate({
                          monthly_budget_amount: n,
                          monthly_budget_currency:
                            user.monthly_budget_currency ?? user.preferred_currency ?? "EUR",
                        });
                      }
                    }
                  }}
                  className="w-full min-h-[44px] px-3 bg-[var(--surface-sunken)] text-[var(--color-ivoire)]"
                  style={{
                    border: "1px solid color-mix(in oklab, var(--color-or) 30%, transparent)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
                <p className="mt-2 text-[11px] text-[var(--on-surface-subtle)]">
                  {t("settings.budget.hint", {
                    default:
                      "Laisser vide pour aucun plafond. Sert de repère sur le plan de trésorerie des précommandes.",
                  })}
                </p>
              </div>

              <div className="mt-6">
                <FxSettings />
              </div>
            </SettingsPanel>

            {/* 漫 Manga — cross-collection link. */}
            <SettingsPanel
              id="manga"
              kanji="漫"
              eyebrow={t("settings.nav.manga")}
              title={t("settings.manga.title")}
              registerRef={registerRef}
            >
              <MangaSettings />
            </SettingsPanel>

            {/* 影 Arrière-plan — background-removal model size. */}
            <SettingsPanel
              id="bg_model"
              kanji="影"
              eyebrow={t("settings.nav.bg_model")}
              title={t("settings.bg_model")}
              registerRef={registerRef}
            >
              <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
                {t("settings.bg_model.body")}
              </p>
              <div className="max-w-sm mt-4">
                <Select
                  label={t("settings.bg_model")}
                  value={bgModel}
                  onChange={onBgModel}
                  hint={t("settings.bg_model.hint")}
                  options={BG_MODEL_SIZES.map((size) => ({
                    value: size,
                    label: t(`settings.bg_model.${size}`),
                  }))}
                />
              </div>
            </SettingsPanel>

            {/* 鈴 Notifications — channels + routing. Always rendered: when the
                admin has enabled no channel, NotificationSettings collapses to
                nothing, so we show a quiet note instead of a silent void. */}
            <SettingsPanel
              id="notif"
              kanji="鈴"
              eyebrow={t("settings.nav.notif_chan")}
              title={t("notif.channels.title")}
              registerRef={registerRef}
            >
              {hasAnyChannel ? (
                <NotificationSettings t={t} />
              ) : (
                <EmptyState
                  compact
                  kanji="鈴"
                  eyebrow={t("settings.nav.notif_chan")}
                  title={t("settings.notif.none.title", {
                    default: "Aucun canal configuré",
                  })}
                  body={t("settings.notif.none.body", {
                    default:
                      "Aucun canal de notification n'a été activé par l'administrateur. Rien à régler ici pour l'instant.",
                  })}
                />
              )}
            </SettingsPanel>

            {/* 禁 Confidentialité — public profile + NSFW visibility. */}
            <PrivacyPanel user={user} registerRef={registerRef} />

            {/* 蔵 Archives — exports + insurance dossier. */}
            <ArchivesPanel registerRef={registerRef} />
          </div>
        </div>
      </PageLayout>
    </AppShell>
  );
}

// =============================================================================
// Scroll spy — keeps the index in sync with the panel scrolled into view.
// Plain scroll listener (simpler than IntersectionObserver around ref timing):
// the active section is the LAST whose header top has passed a line ~28% down
// the viewport. Honours the panels' `scroll-mt`.
// =============================================================================

function useScrollSpy(sections, setActive, refMap) {
  useEffect(() => {
    let frame = 0;
    function compute() {
      frame = 0;
      const triggerY = window.innerHeight * 0.28;
      let candidate = null;
      for (const s of sections) {
        const el = refMap.current[s.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top <= triggerY) candidate = s.id;
      }
      setActive(candidate ?? sections[0].id);
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(compute);
    }
    compute();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections, setActive, refMap]);
}
