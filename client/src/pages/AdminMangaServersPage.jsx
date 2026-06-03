import { useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAdminMangaServers,
  useApproveMangaServer,
  useDeleteMangaServer,
  usePatchMangaServer,
  useRevokeMangaServer,
} from "../hooks/useAdminMangaServers.js";
import EmptyState from "../components/EmptyState.jsx";

const JADE = "var(--color-jade)";
const OR = "var(--color-or)";
const LAQUE = "var(--color-laque-bright)";
const INDIGO_BRIGHT = "var(--color-indigo-bright)";

const STATUS_TONE = { pending: OR, approved: JADE, revoked: LAQUE };

function host(url) {
  return String(url ?? "").replace(/^https?:\/\//, "");
}

function fmtDate(s) {
  if (!s) return null;
  try {
    return new Date(s).toLocaleDateString(document.documentElement.lang || undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

/**
 * 認 — admin curation of the MangaCollector allow-list (/admin/manga-servers).
 *
 * Three status groups, in review priority: pending (approve / refuse),
 * approved (relabel / revoke), revoked (re-approve / delete). Approving or
 * revoking notifies every linked user server-side; the hooks invalidate the
 * public picker + every user's own link status so the change cascades.
 */
export default function AdminMangaServersPage() {
  const t = useT();
  const q = useAdminMangaServers();
  const rows = q.data ?? [];

  const { pending, approved, revoked } = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === "pending"),
      approved: rows.filter((r) => r.status === "approved"),
      revoked: rows.filter((r) => r.status === "revoked"),
    }),
    [rows],
  );

  return (
    <section className="space-y-8">
      <header className="relative">
        <span
          aria-hidden
          className="ja absolute -top-6 -right-2 text-[10rem] leading-none text-[var(--color-indigo)]/[0.07] select-none pointer-events-none hidden md:block"
        >
          認
        </span>
        <p className="micro">{t("admin.manga_servers.eyebrow")}</p>
        <h2 className="display text-3xl md:text-4xl text-[var(--color-ivoire)] mt-2">
          {t("admin.manga_servers.title")}
        </h2>
        <div className="gold-rule w-16 mt-4" />
        <p className="mt-5 text-[var(--color-ivoire-soft)] leading-relaxed max-w-2xl">
          {t("admin.manga_servers.body")}
        </p>
      </header>

      {q.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)] py-12">…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          kanji="認"
          title={t("admin.manga_servers.empty.title")}
          body={t("admin.manga_servers.empty.body")}
        />
      ) : (
        <div className="space-y-9">
          <Section t={t} title={t("admin.manga_servers.section.pending")} items={pending} />
          <Section t={t} title={t("admin.manga_servers.section.approved")} items={approved} />
          <Section t={t} title={t("admin.manga_servers.section.revoked")} items={revoked} />
        </div>
      )}
    </section>
  );
}

function Section({ t, title, items }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="display text-[1.35rem] text-[var(--color-ivoire)]">{title}</h3>
        <span className="flex-1 h-px bg-[linear-gradient(to_right,color-mix(in_oklab,var(--color-or)_30%,transparent),transparent)]" />
        <span className="font-mono text-[10px] tracking-[0.18em] text-[var(--color-ivoire-soft)]">
          {items.length}
        </span>
      </div>
      <ul className="space-y-2.5">
        {items.map((s) => (
          <ServerRow key={s.id} server={s} t={t} />
        ))}
      </ul>
    </div>
  );
}

function ServerRow({ server, t }) {
  const approve = useApproveMangaServer();
  const revoke = useRevokeMangaServer();
  const patch = usePatchMangaServer();
  const del = useDeleteMangaServer();

  const [mode, setMode] = useState(null); // null | 'revoke' | 'label' | 'delete'
  const tone = STATUS_TONE[server.status] ?? OR;
  const busy =
    approve.isPending || revoke.isPending || patch.isPending || del.isPending;

  const submittedDate = fmtDate(server.created_at);
  const reviewedDate = fmtDate(server.reviewed_at);

  return (
    <li
      className="p-3.5"
      style={{
        border: "1px solid color-mix(in oklab, var(--color-or) 14%, transparent)",
        borderLeft: `2px solid ${tone}`,
        background: "color-mix(in oklab, var(--color-noir-soft) 50%, transparent)",
        opacity: server.status === "revoked" ? 0.92 : 1,
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <span
          className="shrink-0 inline-flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] px-[0.6em] py-[0.3em] border mt-0.5"
          style={{ color: tone, borderColor: `color-mix(in oklab, ${tone} 50%, transparent)` }}
        >
          <span className="w-[6px] h-[6px] rounded-full" style={{ background: tone, boxShadow: `0 0 6px ${tone}` }} />
          {t(`admin.manga_servers.status.${server.status}`)}
        </span>

        <div className="flex-1 min-w-[12rem]">
          <div className="font-mono text-[13px] text-[var(--color-ivoire)] flex items-center gap-2 flex-wrap">
            {server.label ? (
              <span className="font-[var(--font-display)] not-italic text-[var(--color-or-pale)]" style={{ fontFamily: "var(--font-display)" }}>
                {server.label}
              </span>
            ) : null}
            <span className="break-all">{host(server.base_url)}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono tracking-[0.04em] text-[var(--color-ivoire-soft)]">
            {server.submitted_by_username ? (
              <span>
                {t("admin.manga_servers.meta.submitted_by", { user: server.submitted_by_username })}
                {submittedDate ? ` · ${submittedDate}` : ""}
              </span>
            ) : null}
            {server.status !== "pending" && server.reviewed_by_username ? (
              <span>
                {t(
                  server.status === "approved"
                    ? "admin.manga_servers.meta.approved_by"
                    : "admin.manga_servers.meta.revoked_by",
                  { user: server.reviewed_by_username },
                )}
                {reviewedDate ? ` · ${reviewedDate}` : ""}
              </span>
            ) : null}
            <span style={{ color: server.user_count > 0 ? INDIGO_BRIGHT : undefined }}>
              {t(
                server.user_count === 1
                  ? "admin.manga_servers.meta.users_one"
                  : "admin.manga_servers.meta.users",
                { n: server.user_count },
              )}
            </span>
          </div>
          {server.status === "revoked" && server.note ? (
            <p className="mt-1.5 text-[11px] italic" style={{ color: LAQUE }}>
              {t("admin.manga_servers.meta.reason", { reason: server.note })}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2 items-center flex-wrap justify-end shrink-0">
          {mode === null ? (
            <>
              {(server.status === "pending" || server.status === "revoked") ? (
                <ActBtn
                  tone={JADE}
                  busy={busy}
                  onClick={() => approve.mutate(server.id)}
                  label={
                    server.status === "revoked"
                      ? t("admin.manga_servers.action.reapprove")
                      : t("admin.manga_servers.action.approve")
                  }
                />
              ) : null}
              {server.status === "approved" ? (
                <>
                  <IconBtn title={t("admin.manga_servers.action.edit")} onClick={() => setMode("label")}>
                    ✎
                  </IconBtn>
                  <ActBtn
                    tone={LAQUE}
                    busy={busy}
                    onClick={() => setMode("revoke")}
                    label={t("admin.manga_servers.action.revoke")}
                  />
                </>
              ) : null}
              <IconBtn
                danger
                title={t("admin.manga_servers.action.delete")}
                onClick={() => setMode("delete")}
              >
                ×
              </IconBtn>
            </>
          ) : null}

          {mode === "delete" ? (
            <DeleteConfirm
              t={t}
              busy={del.isPending}
              error={del.isError ? del.error?.message : null}
              onYes={() =>
                del.mutate(server.id, {
                  onSuccess: () => setMode(null),
                  // leave the inline error visible on failure (e.g. in use)
                })
              }
              onNo={() => {
                del.reset();
                setMode(null);
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Revoke — optional reason, surfaced to linked users */}
      {mode === "revoke" ? (
        <RevokeForm
          t={t}
          users={server.user_count}
          busy={revoke.isPending}
          onConfirm={(note) =>
            revoke.mutate({ id: server.id, note }, { onSuccess: () => setMode(null) })
          }
          onCancel={() => setMode(null)}
        />
      ) : null}

      {mode === "label" ? (
        <LabelForm
          t={t}
          initial={server.label ?? ""}
          busy={patch.isPending}
          onSave={(label) =>
            patch.mutate({ id: server.id, label }, { onSuccess: () => setMode(null) })
          }
          onCancel={() => setMode(null)}
        />
      ) : null}
    </li>
  );
}

function ActBtn({ tone, label, onClick, busy }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="text-[10px] uppercase tracking-[0.14em] px-2.5 py-1.5 border transition-colors disabled:opacity-50 whitespace-nowrap"
      style={{ color: tone, borderColor: `color-mix(in oklab, ${tone} 55%, transparent)` }}
    >
      {label}
    </button>
  );
}

function IconBtn({ children, title, onClick, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="w-[30px] h-[30px] grid place-items-center border bg-transparent text-[13px] transition-colors"
      style={{
        color: "var(--color-or-pale)",
        borderColor: "color-mix(in oklab, var(--color-or) 30%, transparent)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = danger ? LAQUE : OR;
        e.currentTarget.style.color = danger ? LAQUE : "var(--color-or)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "color-mix(in oklab, var(--color-or) 30%, transparent)";
        e.currentTarget.style.color = "var(--color-or-pale)";
      }}
    >
      {children}
    </button>
  );
}

function RevokeForm({ t, users, busy, onConfirm, onCancel }) {
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-[color-mix(in_oklab,var(--color-laque-bright)_30%,transparent)] flex flex-wrap items-center gap-2.5">
      <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-or-pale)]">
        {t("admin.manga_servers.revoke.reason")}
      </span>
      <input
        type="text"
        value={note}
        autoFocus
        onChange={(e) => setNote(e.target.value)}
        placeholder={t(
          users === 1
            ? "admin.manga_servers.revoke.reason_ph_one"
            : "admin.manga_servers.revoke.reason_ph",
          { n: users },
        )}
        className="flex-1 min-w-[16rem] bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] text-[var(--color-ivoire)] outline-none focus:border-[var(--color-laque-bright)]"
      />
      <button
        type="button"
        onClick={() => onConfirm(note)}
        disabled={busy}
        className="text-[10px] uppercase tracking-[0.14em] px-3 py-2 border disabled:opacity-50"
        style={{ color: LAQUE, borderColor: `color-mix(in oklab, ${LAQUE} 55%, transparent)` }}
      >
        {t("admin.manga_servers.revoke.confirm")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] uppercase tracking-[0.14em] px-3 py-2 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
      >
        {t("editor.cancel")}
      </button>
    </div>
  );
}

function LabelForm({ t, initial, busy, onSave, onCancel }) {
  const [label, setLabel] = useState(initial);
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-[color-mix(in_oklab,var(--color-or)_22%,transparent)] flex flex-wrap items-center gap-2.5">
      <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-or-pale)]">
        {t("admin.manga_servers.label.title")}
      </span>
      <input
        type="text"
        value={label}
        autoFocus
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("admin.manga_servers.label.ph")}
        className="flex-1 min-w-[14rem] bg-[var(--color-noir)] border border-[color-mix(in_oklab,var(--color-or)_25%,transparent)] px-3 py-2 text-[12px] text-[var(--color-ivoire)] outline-none focus:border-[var(--color-indigo)]"
      />
      <button
        type="button"
        onClick={() => onSave(label)}
        disabled={busy}
        className="text-[10px] uppercase tracking-[0.14em] px-3 py-2 border border-[var(--color-or)]/55 text-[var(--color-or)] disabled:opacity-50"
      >
        {t("editor.save")}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] uppercase tracking-[0.14em] px-3 py-2 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
      >
        {t("editor.cancel")}
      </button>
    </div>
  );
}

function DeleteConfirm({ t, busy, error, onYes, onNo }) {
  return (
    <span className="inline-flex items-center gap-2">
      {error ? (
        <span className="text-[11px] text-[var(--color-laque-bright)] max-w-[14rem]">
          {t("admin.manga_servers.delete.in_use")}
        </span>
      ) : (
        <span className="text-[11px] text-[var(--color-ivoire-soft)]">
          {t("admin.manga_servers.delete.confirm")}
        </span>
      )}
      <button
        type="button"
        onClick={onYes}
        disabled={busy}
        className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 bg-[var(--color-laque)] text-[var(--color-ivoire)] disabled:opacity-60"
      >
        {t("admin.manga_servers.delete.yes")}
      </button>
      <button
        type="button"
        onClick={onNo}
        className="text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] text-[var(--color-ivoire-soft)]"
      >
        {t("admin.manga_servers.delete.no")}
      </button>
    </span>
  );
}
