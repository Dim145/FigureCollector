import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useMe } from "../hooks/useMe.js";
import {
  useAdminUsers,
  useBulkDeleteUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  usePatchAdminUser,
} from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import Card from "../components/Card.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import EmptyState from "../components/EmptyState.jsx";
import FormField from "../components/FormField.jsx";
import StatCard from "../components/StatCard.jsx";

/**
 * /admin/users — the account register, redrawn to Direction A ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * admin nav already sit above. This view is therefore an editorial *section*
 * of the admin surface (kicker · 衆 · label → AccentTitle h2 → gold-rule), not
 * a second page header — mirroring AdminOverviewPage's section anatomy.
 *
 *   - an editorial section header over a faint 衆 kanji-mark, with the
 *     hanko-red "New user" primary CTA inline on the right;
 *   - a four-up StatCard strip derived purely from the loaded rows (accounts,
 *     admins in hanko-red, owned pieces in gold, submissions);
 *   - the roster as a hairline-bordered Direction-A table inside a Card —
 *     mono usernames/ids/dates, .figural counts, a gold pill for the admin
 *     role, hanko-red for the destructive delete affordance;
 *   - the inline row editor + create dialog restyled to the A language.
 *
 * Data + behaviour are unchanged: the same `useAdminUsers` query, the same
 * patch / delete / bulk-delete / create mutations, the same `useRowSelection`
 * + BulkActionBar, the same self-delete guard (`mine`). GPU-light throughout —
 * flat fills, hairlines, the shared `.reveal` stagger, no meshes / blur.
 */
export default function AdminUsersPage() {
  const t = useT();
  const users = useAdminUsers();
  const me = useMe();
  const myId = me.data?.user?.id;
  const [creating, setCreating] = useState(false);
  const bulkDel = useBulkDeleteUsers();

  // Selectable rows exclude yourself — the server refuses to delete the
  // caller anyway, so keep it out of the "select all" set entirely.
  const ids = useMemo(
    () => (users.data ?? []).filter((u) => u.id !== myId).map((u) => u.id),
    [users.data, myId],
  );
  const sel = useRowSelection(ids);

  // Roster roll-ups for the stat strip — derived purely from the loaded rows
  // (no extra fetch). Counts only; gold marks the catalogue total (owned
  // pieces), hanko-red flags the privileged admin count, per the playbook.
  const rows = users.data ?? [];
  const adminCount = rows.filter((u) => u.is_admin).length;
  const ownedTotal = rows.reduce((n, u) => n + (u.owned_count ?? 0), 0);
  const figureTotal = rows.reduce((n, u) => n + (u.figure_count ?? 0), 0);
  const stats = [
    { label: t("admin.users.col.username"), value: rows.length },
    { label: t("admin.users.role.admin"), value: adminCount, tone: "red" },
    { label: t("admin.users.col.owned"), value: ownedTotal, tone: "gold" },
    { label: t("admin.users.col.figures"), value: figureTotal },
  ];

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <span
          aria-hidden
          className="kanji-mark text-[15rem] -top-20 -right-4 hidden md:block select-none"
        >
          衆
        </span>

        <div className="relative">
          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span
              aria-hidden
              className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
            />
            {t("admin.users.subtitle")}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">
              衆
            </span>
            {t("admin.users.kicker_label", { default: "COMPTES" })}
          </p>
          <h2
            className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("admin.tab.users")} />
          </h2>
          <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        </div>

        <div className="relative reveal" style={{ "--i": 2 }}>
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("admin.users.new")}
          </Button>
        </div>
      </header>

      {users.isLoading ? (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-[var(--color-ivoire-soft)] py-12"
        >
          …
        </p>
      ) : users.data?.length ? (
        <>
          {/* ─── Roster metrics strip ─── */}
          <section
            className="reveal"
            style={{ "--i": 3 }}
            aria-label={t("admin.users.metrics", { default: "Compteurs des comptes" })}
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {stats.map((s) => (
                <StatCard
                  key={s.label}
                  label={s.label}
                  value={s.value}
                  tone={s.tone}
                />
              ))}
            </div>
          </section>

          {/* ─── Roster table ─── */}
          <Card className="overflow-x-auto mt-8 reveal" style={{ "--i": 4 }}>
            <BulkActionBar
              selectedIds={sel.selectedIds}
              onClear={sel.clear}
              onDelete={(idList) => bulkDel.mutateAsync(idList)}
              busy={bulkDel.isPending}
              confirmBody={t("admin.bulk.confirm.body.users", {
                n: sel.selectedIds.length,
              })}
            />
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] border-b border-[var(--color-or)]/15">
                  <th className="px-4 py-3.5 font-normal w-[34px]">
                    <SelectCheckbox
                      checked={sel.allSelected}
                      indeterminate={sel.someSelected && !sel.allSelected}
                      onChange={sel.toggleAll}
                      label={t("admin.bulk.select_all")}
                    />
                  </th>
                  <Th>{t("admin.users.col.username")}</Th>
                  <Th>{t("admin.users.col.email")}</Th>
                  <Th>{t("admin.users.col.role")}</Th>
                  <Th right>{t("admin.users.col.owned")}</Th>
                  <Th right>{t("admin.users.col.figures")}</Th>
                  <Th>{t("admin.users.col.created")}</Th>
                  <Th right>{t("admin.users.col.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {users.data.map((u) => (
                  <Row
                    key={u.id}
                    user={u}
                    mine={u.id === myId}
                    selected={sel.isSelected(u.id)}
                    onToggle={() => sel.toggle(u.id)}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <EmptyState
          compact
          kanji="人"
          hue="var(--color-indigo)"
          title={t("admin.empty.users.title")}
          body={t("admin.empty.users.body")}
        />
      )}

      {creating ? (
        <CreateUserDialog onClose={() => setCreating(false)} t={t} />
      ) : null}
    </div>
  );
}

function Th({ children, right }) {
  return (
    <th className={`px-4 py-3.5 font-normal ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Td({ children, right, className = "" }) {
  return (
    <td
      className={`px-4 py-3.5 align-middle ${right ? "text-right" : ""} ${className}`}
    >
      {children}
    </td>
  );
}

function Row({ user, mine, selected, onToggle, t }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const patch = usePatchAdminUser();
  const del = useDeleteAdminUser();

  const toggleAdmin = async () => {
    await patch.mutateAsync({ id: user.id, patch: { is_admin: !user.is_admin } });
  };

  const onDelete = async () => {
    await del.mutateAsync(user.id);
    setConfirming(false);
  };

  return (
    <>
      <tr
        className={`border-b border-[var(--color-or)]/10 hover:bg-[var(--color-or)]/5 transition-colors ${
          selected ? "adm-row-selected" : ""
        }`}
      >
        <Td>
          {mine ? (
            <span aria-hidden className="inline-block w-[18px]" />
          ) : (
            <SelectCheckbox
              checked={selected}
              onChange={onToggle}
              label={t("admin.bulk.select_row")}
            />
          )}
        </Td>
        <Td>
          <span className="font-mono text-[var(--color-ivoire)]">{user.username}</span>
          {mine ? (
            <span className="ml-2 px-1.5 py-0.5 text-[9px] tracking-[0.2em] uppercase border border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)]">
              {t("admin.users.tag.you")}
            </span>
          ) : null}
        </Td>
        <Td>
          <span className="text-[var(--color-ivoire-soft)]">{user.email ?? "—"}</span>
        </Td>
        <Td>
          {user.is_admin ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)] text-[var(--color-or)]">
              <span aria-hidden className="ja not-italic text-[11px] leading-none">
                管
              </span>
              {t("admin.users.role.admin")}
            </span>
          ) : (
            <span className="text-[var(--color-ivoire-soft)] text-xs uppercase tracking-[0.18em]">
              {t("admin.users.role.user")}
            </span>
          )}
        </Td>
        <Td right>
          <span className="figural text-base text-[var(--color-or-pale)]">
            {Number(user.owned_count ?? 0).toLocaleString(appLocale())}
          </span>
        </Td>
        <Td right>
          <span className="figural text-base text-[var(--color-or-pale)]">
            {Number(user.figure_count ?? 0).toLocaleString(appLocale())}
          </span>
        </Td>
        <Td>
          <span className="text-[10px] font-mono tracking-wider text-[var(--color-ivoire-soft)]/70">
            {new Date(user.created_at).toLocaleDateString(appLocale())}
          </span>
        </Td>
        <Td right>
          <div className="flex items-center gap-1 justify-end">
            <button
              type="button"
              onClick={toggleAdmin}
              disabled={patch.isPending}
              title={user.is_admin ? t("admin.users.action.demote") : t("admin.users.action.promote")}
              aria-label={user.is_admin ? t("admin.users.action.demote") : t("admin.users.action.promote")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] disabled:opacity-40 text-xs px-2 py-1 transition-colors"
            >
              {user.is_admin ? "▼" : "▲"}
            </button>
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              aria-expanded={editing}
              title={t("admin.users.action.edit")}
              aria-label={t("admin.users.action.edit")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xs px-2 py-1 transition-colors"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={mine}
              title={mine ? t("admin.users.action.cant_delete_self") : t("admin.users.action.delete")}
              aria-label={mine ? t("admin.users.action.cant_delete_self") : t("admin.users.action.delete")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] disabled:opacity-30 disabled:cursor-not-allowed text-xs px-2 py-1 transition-colors"
            >
              ×
            </button>
          </div>
        </Td>
      </tr>

      {editing ? (
        <tr>
          <td
            colSpan={8}
            className="border-b border-[var(--color-or)]/10"
            style={{
              background: "color-mix(in oklab, var(--color-noir-deep) 55%, transparent)",
            }}
          >
            <EditUserInline user={user} onClose={() => setEditing(false)} t={t} />
          </td>
        </tr>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t("admin.users.confirm_delete.title", { name: user.display_name })}
        body={t("admin.users.confirm_delete.body")}
        confirmLabel={t("admin.users.confirm_delete.confirm")}
        onConfirm={onDelete}
        onCancel={() => setConfirming(false)}
        busy={del.isPending}
        destructive
      />
    </>
  );
}

function EditUserInline({ user, onClose, t }) {
  const patch = usePatchAdminUser();
  const [display, setDisplay] = useState(user.display_name);
  const [email, setEmail] = useState(user.email ?? "");
  const [locale, setLocale] = useState(user.locale);
  const [password, setPassword] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    const body = {};
    if (display !== user.display_name) body.display_name = display;
    if (email !== (user.email ?? "")) body.email = email || null;
    if (locale !== user.locale) body.locale = locale;
    if (password) body.password = password;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    await patch.mutateAsync({ id: user.id, patch: body });
    onClose();
  };

  return (
    <form onSubmit={onSubmit} className="p-5 md:p-6">
      {/* Editorial sub-header so the expanded editor reads as an A panel, not
          a raw inline form. Mirrors SettingsPage's Panel kicker. */}
      <div className="mb-5">
        <p className="micro flex items-center gap-2">
          <span aria-hidden className="ja not-italic text-base text-[var(--color-or)] leading-none">
            筆
          </span>
          {t("admin.users.edit.eyebrow", { default: "MODIFIER" })}
          <span className="font-mono text-[var(--color-ivoire)] normal-case tracking-normal">
            {user.username}
          </span>
        </p>
        <div className="gold-rule w-12 mt-3" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <FormField
          label={t("admin.users.field.display_name")}
          value={display}
          onChange={setDisplay}
        />
        <FormField
          label={t("admin.users.field.email")}
          type="email"
          value={email}
          onChange={setEmail}
        />
        <FormField label={t("admin.users.field.locale")} value={locale} onChange={setLocale} />
        <FormField
          label={t("admin.users.field.new_password")}
          hint={t("admin.users.field.password_hint")}
          type="password"
          value={password}
          onChange={setPassword}
        />
      </div>
      {patch.error ? (
        <p role="alert" className="mt-4 text-sm text-[var(--color-laque-bright)]">
          {patch.error.message}
        </p>
      ) : null}
      <div className="mt-5 flex items-center gap-3 justify-end">
        <Button variant="ghost" onClick={onClose} type="button">
          {t("editor.cancel")}
        </Button>
        <Button variant="primary" type="submit" loading={patch.isPending}>
          {t("admin.users.save")}
        </Button>
      </div>
    </form>
  );
}

function CreateUserDialog({ onClose, t }) {
  const create = useCreateAdminUser();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    await create.mutateAsync({
      username,
      password,
      display_name: displayName || undefined,
      email: email || undefined,
      is_admin: isAdmin,
    });
    if (!create.isError) onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-labelledby="create-user-dialog-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative overflow-hidden bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-md space-y-4"
        style={{ boxShadow: "0 40px 90px -40px color-mix(in oklab, var(--color-noir-deep) 85%, transparent)" }}
      >
        {/* Calm 衆 watermark, gold, bleeding off the corner — GPU-free. */}
        <span
          aria-hidden
          className="kanji-mark text-[8rem] -top-6 -right-2 select-none"
        >
          衆
        </span>
        <header className="relative mb-2">
          <p className="micro flex items-center gap-2">
            <span aria-hidden className="ja not-italic text-base text-[var(--color-or)] leading-none">
              衆
            </span>
            {t("admin.users.new.subtitle")}
          </p>
          <h2
            id="create-user-dialog-title"
            className="display text-2xl text-[var(--color-ivoire)] mt-2 leading-tight"
          >
            <AccentTitle text={t("admin.users.new")} />
          </h2>
          <div className="gold-rule w-16 mt-3" />
        </header>
        <FormField label={t("register.field.username")} value={username} onChange={setUsername} required />
        <FormField label={t("register.field.display_name")} value={displayName} onChange={setDisplayName} />
        <FormField label={t("register.field.email")} type="email" value={email} onChange={setEmail} />
        <FormField label={t("register.field.password")} type="password" value={password} onChange={setPassword} required />
        <label className="flex items-center gap-3 text-sm text-[var(--color-ivoire)] cursor-pointer select-none tap-target">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="accent-[var(--color-laque)] w-4 h-4"
          />
          <span>{t("admin.users.new.is_admin")}</span>
        </label>
        {create.error ? (
          <p role="alert" className="text-sm text-[var(--color-laque-bright)]">
            {create.error.message}
          </p>
        ) : null}
        <div className="relative flex items-center gap-3 justify-end pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            {t("admin.users.new.create")}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
