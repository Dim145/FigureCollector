import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useMangaLink,
  useSetMangaLink,
  useClearMangaLink,
} from "../hooks/useMangaLink.js";

const INDIGO = "var(--color-indigo)";
const INDIGO_BRIGHT = "var(--color-indigo-bright)";

/**
 * 漫 — the MangaCollector link drawer body (Settings · L'Atelier).
 *
 * Disconnected: two fields (instance URL + public slug) and a "Connect / Test"
 * button. The link is read-only and server-side — no token, no password — so
 * the only inputs are the public instance + the public profile slug.
 *
 * Connected: a hanko-stamped card with the linked display name (jade
 * "connected" dot), the series/volumes tallies, and a "Unlink" control.
 *
 * Errors map straight off the API status: 400 → bad/empty/disallowed URL,
 * 503 → instance unreachable. Anything else falls back to the generic
 * "couldn't connect" copy.
 */
export default function MangaSettings() {
  const t = useT();
  const link = useMangaLink();
  const setLink = useSetMangaLink();
  const clearLink = useClearMangaLink();

  const connected = !!link.data?.connected;
  const profile = link.data?.profile ?? null;

  const [baseUrl, setBaseUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);

  // Resolve the connect error into one of three messages off the HTTP status.
  const errorKey = (() => {
    if (!setLink.isError) return null;
    const status = setLink.error?.status;
    if (status === 400) return "settings.manga.error.bad_url";
    if (status === 503) return "settings.manga.error.unreachable";
    return "settings.manga.error.generic";
  })();

  const submit = (e) => {
    e.preventDefault();
    const b = baseUrl.trim();
    const s = slug.trim();
    if (!b || !s) return;
    setLink.mutate({ base_url: b, slug: s });
  };

  const unlink = () => {
    clearLink.mutate(undefined, { onSuccess: () => setConfirmOff(false) });
  };

  return (
    <div>
      <p className="atelier-drawer-desc">{t("settings.manga.body")}</p>

      {connected ? (
        // ── Connected card ───────────────────────────────────────────────
        <div
          className="mt-2 flex items-center gap-4 p-4"
          style={{
            border: `1px solid color-mix(in oklab, ${INDIGO} 28%, transparent)`,
            background: `color-mix(in oklab, ${INDIGO} 7%, transparent)`,
          }}
        >
          {/* Hanko stamp — 蔵 (the archive / storehouse) in laque red. */}
          <span
            aria-hidden
            className="ja shrink-0 grid place-items-center w-14 h-14 rounded-full text-2xl"
            style={{
              color: "var(--color-laque-bright)",
              border:
                "2px solid color-mix(in oklab, var(--color-laque-bright) 60%, transparent)",
              background: "color-mix(in oklab, var(--color-laque) 12%, transparent)",
            }}
          >
            蔵
          </span>
          <div className="flex-1 min-w-0">
            <div className="display text-2xl text-[var(--color-ivoire)] flex items-center gap-2 leading-tight">
              <span className="truncate">
                {profile?.display_name ?? link.data?.slug}
              </span>
              <span
                aria-hidden
                title={t("settings.manga.connected")}
                className="shrink-0 w-[7px] h-[7px] rounded-full"
                style={{
                  background: "var(--color-jade)",
                  boxShadow: "0 0 7px var(--color-jade)",
                }}
              />
            </div>
            <p className="mt-1 text-[12px] text-[var(--color-ivoire-soft)]">
              <span className="font-mono" style={{ color: INDIGO_BRIGHT }}>
                {t("settings.manga.tally", {
                  series: profile?.series_count ?? 0,
                  volumes: profile?.volumes_owned ?? 0,
                })}
              </span>
              {link.data?.slug ? (
                <>
                  {" · "}
                  <code className="text-[var(--color-ivoire-soft)]">
                    /u/{link.data.slug}
                  </code>
                </>
              ) : null}
            </p>
          </div>
          {confirmOff ? (
            <span className="shrink-0 inline-flex items-center gap-2 text-[12px]">
              <button
                type="button"
                onClick={unlink}
                disabled={clearLink.isPending}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] bg-[var(--color-laque)] text-[var(--color-ivoire)] disabled:opacity-60"
              >
                {t("settings.manga.unlink")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmOff(false)}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
              >
                {t("editor.cancel")}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOff(true)}
              className="shrink-0 px-3 py-2 text-[11px] uppercase tracking-[0.16em] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
            >
              {t("settings.manga.unlink")}
            </button>
          )}
        </div>
      ) : (
        // ── Connect form ─────────────────────────────────────────────────
        <form onSubmit={submit} className="mt-2">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="atelier-url-eyebrow">
                {t("settings.manga.field.url")}
              </span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t("settings.manga.field.url_ph")}
                className="mt-1.5 w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] font-mono text-[var(--color-ivoire)] outline-none focus:border-[var(--color-indigo)]"
              />
            </label>
            <label className="block">
              <span className="atelier-url-eyebrow">
                {t("settings.manga.field.slug")}
              </span>
              <input
                type="text"
                autoComplete="off"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder={t("settings.manga.field.slug_ph")}
                className="mt-1.5 w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] font-mono text-[var(--color-ivoire)] outline-none focus:border-[var(--color-indigo)]"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <button
              type="submit"
              disabled={setLink.isPending || !baseUrl.trim() || !slug.trim()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivoire)] disabled:opacity-50 transition-opacity"
              style={{
                background: `color-mix(in oklab, ${INDIGO} 18%, transparent)`,
                border: `1px solid ${INDIGO}`,
              }}
            >
              <span className="ja" aria-hidden>
                連
              </span>
              {setLink.isPending
                ? t("settings.manga.connecting")
                : t("settings.manga.connect")}
            </button>
            {errorKey ? (
              <span className="text-[12px] text-[var(--color-laque-bright)]">
                {t(errorKey)}
              </span>
            ) : null}
          </div>
        </form>
      )}

      {/* Read-only note — always shown. */}
      <p className="atelier-select-hint" style={{ marginTop: "1rem" }}>
        {t("settings.manga.readonly")}
      </p>
    </div>
  );
}
