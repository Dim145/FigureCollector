import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useAdminSettings, useUpdateAdminSettings } from "../hooks/useAdmin.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";

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

  // The server value is the source of truth; the drafts hold each section's
  // pending edit (null = nothing unsaved). Deriving the live values during
  // render sidesteps a sync effect and re-syncs for free once a save refetches.
  const [draft, setDraft] = useState(null);
  const [cronDraft, setCronDraft] = useState(null);

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
    </div>
  );
}

// One policy row: a hidden native radio for a11y + keyboard, an A diamond
// marker (hanko-red + glow when active, hairline gold otherwise), and a
// label/description stack. The whole row is the click + focus target.
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
