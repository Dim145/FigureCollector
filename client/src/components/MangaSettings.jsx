import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useApprovedServers,
  useClearMangaLink,
  useMangaLink,
  useSetMangaLink,
  useSyncMangaLink,
} from "../hooks/useMangaLink.js";

const INDIGO = "var(--color-indigo)";
const INDIGO_BRIGHT = "var(--color-indigo-bright)";
const OR = "var(--color-or)";

const NEW_SERVER = "__new__";

/** Strip the scheme so a server origin reads as a bare host. */
function host(url) {
  return String(url ?? "").replace(/^https?:\/\//, "");
}

/**
 * 漫 — the MangaCollector link drawer body (Settings · L'Atelier).
 *
 * The instance is no longer free-form: the user picks an admin-APPROVED server
 * from a registry, or submits a new one (which lands `pending` and stays inert
 * until an admin approves it). A live link therefore has three faces —
 * `approved` (active, with the library tally), `pending` (awaiting an admin),
 * and `revoked` (an admin pulled it; pick another). The read-only public-profile
 * model is unchanged: no token, no password, just the public slug.
 */
export default function MangaSettings() {
  const t = useT();
  const link = useMangaLink();
  const clearLink = useClearMangaLink();

  const connected = !!link.data?.connected;
  const status = link.data?.status ?? null;
  const [changing, setChanging] = useState(false);

  const unlink = (after) =>
    clearLink.mutate(undefined, { onSuccess: () => after?.() });

  return (
    <div>
      <p className="atelier-drawer-desc">{t("settings.manga.body")}</p>

      {link.isLoading ? (
        <p className="mt-3 text-[13px] text-[var(--color-ivoire-soft)]">…</p>
      ) : connected && !changing ? (
        status === "approved" ? (
          <ApprovedCard
            t={t}
            link={link.data}
            onUnlink={() => unlink()}
            unlinking={clearLink.isPending}
          />
        ) : status === "pending" ? (
          <PendingCard
            t={t}
            link={link.data}
            onCancel={() => unlink()}
            cancelling={clearLink.isPending}
          />
        ) : (
          <RevokedCard
            t={t}
            link={link.data}
            onChange={() => setChanging(true)}
          />
        )
      ) : (
        <PickerForm
          t={t}
          currentSlug={link.data?.slug ?? ""}
          canCancel={connected}
          onDone={() => setChanging(false)}
        />
      )}

      <p className="atelier-select-hint" style={{ marginTop: "1rem" }}>
        {t("settings.manga.readonly")}
      </p>
    </div>
  );
}

// ── Connected · approved (active) ──────────────────────────────────────────────
function ApprovedCard({ t, link, onUnlink, unlinking }) {
  const [confirmOff, setConfirmOff] = useState(false);
  const sync = useSyncMangaLink();
  const profile = link.profile;
  return (
    <div
      className="mt-2 flex items-center gap-4 p-4"
      style={{
        border: `1px solid color-mix(in oklab, ${INDIGO} 28%, transparent)`,
        background: `color-mix(in oklab, ${INDIGO} 7%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="ja shrink-0 grid place-items-center w-14 h-14 rounded-full text-2xl"
        style={{
          color: "var(--color-laque-bright)",
          border: "2px solid color-mix(in oklab, var(--color-laque-bright) 60%, transparent)",
          background: "color-mix(in oklab, var(--color-laque) 12%, transparent)",
        }}
      >
        蔵
      </span>
      <div className="flex-1 min-w-0">
        <div className="display text-2xl text-[var(--color-ivoire)] flex items-center gap-2 leading-tight">
          <span className="truncate">{profile?.display_name ?? link.slug}</span>
          <span
            aria-hidden
            title={t("settings.manga.connected")}
            className="shrink-0 w-[7px] h-[7px] rounded-full"
            style={{ background: "var(--color-jade)", boxShadow: "0 0 7px var(--color-jade)" }}
          />
        </div>
        <p className="mt-1 text-[12px] text-[var(--color-ivoire-soft)]">
          <span className="font-mono" style={{ color: INDIGO_BRIGHT }}>
            {t("settings.manga.tally", {
              series: profile?.series_count ?? 0,
              volumes: profile?.volumes_owned ?? 0,
            })}
          </span>
          {link.server?.base_url ? (
            <>
              {" · "}
              <code className="text-[var(--color-ivoire-soft)]">
                {host(link.server.base_url)}/u/{link.slug}
              </code>
            </>
          ) : null}
        </p>
        {/* Resync — re-pull the library + recompute crossings on demand. */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[var(--color-ivoire)] disabled:opacity-50 transition-opacity"
            style={{
              background: `color-mix(in oklab, ${INDIGO} 14%, transparent)`,
              border: `1px solid color-mix(in oklab, ${INDIGO} 70%, transparent)`,
            }}
          >
            <span className="ja" aria-hidden>
              {sync.isPending ? "…" : "同"}
            </span>
            {sync.isPending ? t("settings.manga.connecting") : t("settings.manga.sync.cta")}
          </button>
          {sync.isSuccess ? (
            <span
              className="inline-flex items-center gap-1.5 text-[11px]"
              style={{ color: "var(--color-jade)" }}
            >
              <span
                aria-hidden
                className="w-[6px] h-[6px] rounded-full"
                style={{ background: "var(--color-jade)", boxShadow: "0 0 6px var(--color-jade)" }}
              />
              {t("settings.manga.sync.done")}
            </span>
          ) : sync.isError ? (
            <span className="text-[11px] text-[var(--color-laque-bright)]">
              {t("settings.manga.sync.error")}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ivoire-soft)]">
          {t("settings.manga.sync.hint")}
        </p>
      </div>
      {confirmOff ? (
        <span className="shrink-0 inline-flex items-center gap-2 text-[12px]">
          <button
            type="button"
            onClick={onUnlink}
            disabled={unlinking}
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
  );
}

// ── Connected · pending (awaiting an admin) ─────────────────────────────────────
function PendingCard({ t, link, onCancel, cancelling }) {
  return (
    <div
      className="mt-2 flex items-center gap-4 p-4"
      style={{
        border: `1px solid color-mix(in oklab, ${OR} 35%, transparent)`,
        background: `color-mix(in oklab, ${OR} 6%, transparent)`,
      }}
    >
      <span
        aria-hidden
        className="ja shrink-0 grid place-items-center w-14 h-14 rounded-full text-2xl"
        style={{
          color: OR,
          border: `2px dashed color-mix(in oklab, ${OR} 55%, transparent)`,
          background: `color-mix(in oklab, ${OR} 8%, transparent)`,
        }}
      >
        待
      </span>
      <div className="flex-1 min-w-0">
        <div className="display text-xl text-[var(--color-ivoire)] flex items-center gap-2 leading-tight">
          <span className="font-mono text-[14px] truncate">{host(link.server?.base_url)}</span>
          <span
            className="shrink-0 text-[9px] uppercase tracking-[0.14em] px-[0.5em] py-[0.18em] border"
            style={{ color: "var(--color-or-pale)", borderColor: `color-mix(in oklab, ${OR} 45%, transparent)` }}
          >
            {t("settings.manga.status.pending")}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--color-ivoire-soft)] leading-relaxed">
          {t("settings.manga.pending.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="shrink-0 px-3 py-2 text-[11px] uppercase tracking-[0.16em] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-or-pale)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors disabled:opacity-60"
      >
        {t("settings.manga.cancel")}
      </button>
    </div>
  );
}

// ── Connected · revoked (admin pulled it) ───────────────────────────────────────
function RevokedCard({ t, link, onChange }) {
  return (
    <div
      className="mt-2 flex items-center gap-4 p-4"
      style={{
        border: "1px solid color-mix(in oklab, var(--color-laque-bright) 38%, transparent)",
        background: "color-mix(in oklab, var(--color-laque) 8%, transparent)",
      }}
    >
      <span
        aria-hidden
        className="ja shrink-0 grid place-items-center w-14 h-14 rounded-full text-2xl"
        style={{
          color: "var(--color-laque-bright)",
          border: "2px solid color-mix(in oklab, var(--color-laque-bright) 55%, transparent)",
          background: "color-mix(in oklab, var(--color-laque) 14%, transparent)",
        }}
      >
        禁
      </span>
      <div className="flex-1 min-w-0">
        <div className="display text-xl text-[var(--color-ivoire)] flex items-center gap-2 leading-tight">
          <span className="font-mono text-[14px] truncate">{host(link.server?.base_url)}</span>
          <span
            className="shrink-0 text-[9px] uppercase tracking-[0.14em] px-[0.5em] py-[0.18em] border"
            style={{
              color: "var(--color-laque-bright)",
              borderColor: "color-mix(in oklab, var(--color-laque-bright) 50%, transparent)",
            }}
          >
            {t("settings.manga.status.revoked")}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-laque-bright)]">
          {link.revoked_reason
            ? t("settings.manga.revoked.body_reason", { reason: link.revoked_reason })
            : t("settings.manga.revoked.body")}
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 inline-flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivoire)]"
        style={{ background: `color-mix(in oklab, ${INDIGO} 18%, transparent)`, border: `1px solid ${INDIGO}` }}
      >
        {t("settings.manga.revoked.change")}
      </button>
    </div>
  );
}

// ── Picker / submit form ────────────────────────────────────────────────────────
function PickerForm({ t, currentSlug, canCancel, onDone }) {
  const servers = useApprovedServers();
  const setLink = useSetMangaLink();

  const [choice, setChoice] = useState(null); // server id | NEW_SERVER
  const [newUrl, setNewUrl] = useState("");
  const [slug, setSlug] = useState(currentSlug);

  const isNew = choice === NEW_SERVER;
  const list = servers.data ?? [];

  const errorKey = (() => {
    if (!setLink.isError) return null;
    const s = setLink.error?.status;
    if (s === 404) return "settings.manga.error.not_found";
    if (s === 503) return "settings.manga.error.unreachable";
    if (s === 400) return "settings.manga.error.bad_url";
    return "settings.manga.error.generic";
  })();

  const valid = slug.trim() && (isNew ? newUrl.trim() : !!choice);

  const submit = (e) => {
    e.preventDefault();
    if (!valid) return;
    const body = isNew
      ? { new_base_url: newUrl.trim(), slug: slug.trim() }
      : { server_id: choice, slug: slug.trim() };
    setLink.mutate(body, { onSuccess: () => onDone?.() });
  };

  const radioBase =
    "w-full flex items-center gap-3 p-3 text-left border bg-[var(--color-noir-deep)] transition-colors";

  return (
    <form onSubmit={submit} className="mt-2">
      <span className="atelier-url-eyebrow">{t("settings.manga.field.server")}</span>

      <div className="mt-1.5 flex flex-col gap-2">
        {servers.isLoading ? (
          <p className="text-[12px] text-[var(--color-ivoire-soft)] py-2">…</p>
        ) : list.length === 0 ? (
          <p className="text-[12px] text-[var(--color-ivoire-soft)] py-1">
            {t("settings.manga.no_servers")}
          </p>
        ) : (
          list.map((s) => {
            const sel = choice === s.id;
            return (
              <button
                type="button"
                key={s.id}
                onClick={() => setChoice(s.id)}
                className={radioBase}
                style={{
                  borderColor: sel
                    ? INDIGO
                    : "color-mix(in oklab, var(--color-or) 16%, transparent)",
                  background: sel
                    ? `color-mix(in oklab, ${INDIGO} 9%, transparent)`
                    : "var(--color-noir-deep)",
                }}
              >
                <Radio on={sel} />
                <span className="flex-1 min-w-0">
                  <span className="block font-mono text-[12px] text-[var(--color-ivoire)] truncate">
                    {host(s.base_url)}
                  </span>
                  {s.label ? (
                    <span className="block text-[10.5px] text-[var(--color-ivoire-soft)] truncate">
                      {s.label}
                    </span>
                  ) : null}
                </span>
                <span
                  className="shrink-0 text-[9px] uppercase tracking-[0.12em] px-[0.5em] py-[0.18em] border inline-flex items-center gap-1"
                  style={{
                    color: "var(--color-jade)",
                    borderColor: "color-mix(in oklab, var(--color-jade) 50%, transparent)",
                  }}
                >
                  {t("settings.manga.status.approved")}
                </span>
              </button>
            );
          })
        )}

        {/* Submit-a-new-server option */}
        <button
          type="button"
          onClick={() => setChoice(NEW_SERVER)}
          className={radioBase}
          style={{
            borderStyle: "dashed",
            borderColor: isNew
              ? INDIGO
              : "color-mix(in oklab, var(--color-indigo) 30%, transparent)",
            background: isNew ? `color-mix(in oklab, ${INDIGO} 9%, transparent)` : "var(--color-noir-deep)",
          }}
        >
          <span className="ja w-[15px] text-center shrink-0" style={{ color: INDIGO_BRIGHT }} aria-hidden>
            ＋
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[12px]" style={{ color: INDIGO_BRIGHT }}>
              {t("settings.manga.add_server")}
            </span>
            <span className="block text-[10.5px] text-[var(--color-ivoire-soft)]">
              {t("settings.manga.add_server.hint")}
            </span>
          </span>
        </button>
      </div>

      {isNew ? (
        <label className="block mt-3">
          <span className="atelier-url-eyebrow">{t("settings.manga.field.url")}</span>
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder={t("settings.manga.field.url_ph")}
            className="mt-1.5 w-full bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] font-mono text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)]"
          />
        </label>
      ) : null}

      <label className="block mt-3">
        <span className="atelier-url-eyebrow">{t("settings.manga.field.slug")}</span>
        <input
          type="text"
          autoComplete="off"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t("settings.manga.field.slug_ph")}
          className="mt-1.5 w-full max-w-xs bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] font-mono text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)]"
        />
      </label>

      <div className="mt-4 flex items-center gap-4 flex-wrap">
        <button
          type="submit"
          disabled={setLink.isPending || !valid}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-[11px] uppercase tracking-[0.16em] text-[var(--color-ivoire)] disabled:opacity-50 transition-opacity"
          style={{ background: `color-mix(in oklab, ${INDIGO} 18%, transparent)`, border: `1px solid ${INDIGO}` }}
        >
          <span className="ja" aria-hidden>連</span>
          {setLink.isPending ? t("settings.manga.connecting") : t("settings.manga.connect")}
        </button>
        {canCancel ? (
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-2 text-[11px] uppercase tracking-[0.16em] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or-pale)]"
          >
            {t("editor.cancel")}
          </button>
        ) : null}
        {errorKey ? (
          <span className="text-[12px] text-[var(--color-laque-bright)]">{t(errorKey)}</span>
        ) : null}
      </div>
    </form>
  );
}

function Radio({ on }) {
  return (
    <span
      aria-hidden
      className="shrink-0 w-[15px] h-[15px] rounded-full grid place-items-center"
      style={{ border: `1px solid ${on ? INDIGO : "color-mix(in oklab, var(--color-or) 45%, transparent)"}` }}
    >
      {on ? (
        <span className="w-[7px] h-[7px] rounded-full" style={{ background: INDIGO_BRIGHT }} />
      ) : null}
    </span>
  );
}
