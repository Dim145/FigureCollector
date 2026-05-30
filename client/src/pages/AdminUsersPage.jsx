import { useMemo, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useAdminUsers,
  useBulkDeleteUsers,
  useCreateAdminUser,
  useDeleteAdminUser,
  usePatchAdminUser,
} from "../hooks/useAdmin.js";
import { useRowSelection } from "../hooks/useRowSelection.js";
import Button from "../components/Button.jsx";
import BulkActionBar, { SelectCheckbox } from "../components/BulkActionBar.jsx";
import Card from "../components/Card.jsx";
import EmptyState from "../components/EmptyState.jsx";
import FormField from "../components/FormField.jsx";

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

  return (
    <div>
      <header className="flex items-baseline justify-between mb-6 gap-4">
        <p className="micro">{t("admin.users.subtitle")}</p>
        <Button variant="primary" onClick={() => setCreating(true)}>
          {t("admin.users.new")}
        </Button>
      </header>

      {users.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)]">…</p>
      ) : users.data?.length ? (
        <Card className="overflow-x-auto">
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
                <th className="px-4 py-3 font-normal w-[34px]">
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

// -----------------------------------------------------------------------------

function Th({ children, right }) {
  return (
    <th
      className={`px-4 py-3 font-normal ${right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, right, className = "" }) {
  return (
    <td
      className={`px-4 py-3 align-middle ${right ? "text-right" : ""} ${className}`}
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
            <span className="ml-2 px-1.5 py-0.5 text-[9px] tracking-[0.2em] uppercase border border-[var(--color-or)]/40 text-[var(--color-or)]">
              {t("admin.users.tag.you")}
            </span>
          ) : null}
        </Td>
        <Td>
          <span className="text-[var(--color-ivoire-soft)]">{user.email ?? "—"}</span>
        </Td>
        <Td>
          {user.is_admin ? (
            <span className="px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] border border-[var(--color-or)] text-[var(--color-or)]">
              {t("admin.users.role.admin")}
            </span>
          ) : (
            <span className="text-[var(--color-ivoire-soft)] text-xs uppercase tracking-[0.18em]">
              {t("admin.users.role.user")}
            </span>
          )}
        </Td>
        <Td right>
          <span className="font-mono text-[var(--color-or-pale)]">{user.owned_count}</span>
        </Td>
        <Td right>
          <span className="font-mono text-[var(--color-or-pale)]">{user.figure_count}</span>
        </Td>
        <Td>
          <span className="text-[10px] font-mono tracking-wider text-[var(--color-ivoire-soft)]/70">
            {new Date(user.created_at).toLocaleDateString()}
          </span>
        </Td>
        <Td right>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={toggleAdmin}
              disabled={patch.isPending}
              title={user.is_admin ? t("admin.users.action.demote") : t("admin.users.action.promote")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] disabled:opacity-40 text-xs px-2 py-1 transition-colors"
            >
              {user.is_admin ? "▼" : "▲"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={t("admin.users.action.edit")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xs px-2 py-1 transition-colors"
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={mine}
              title={mine ? t("admin.users.action.cant_delete_self") : t("admin.users.action.delete")}
              className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] disabled:opacity-30 disabled:cursor-not-allowed text-xs px-2 py-1 transition-colors"
            >
              ×
            </button>
          </div>
        </Td>
      </tr>

      {editing ? (
        <tr>
          <td colSpan={8} className="bg-[var(--color-noir)]/40 border-b border-[var(--color-or)]/10">
            <EditUserInline user={user} onClose={() => setEditing(false)} t={t} />
          </td>
        </tr>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          title={t("admin.users.confirm_delete.title", { name: user.display_name })}
          body={t("admin.users.confirm_delete.body")}
          onConfirm={onDelete}
          onCancel={() => setConfirming(false)}
          loading={del.isPending}
          danger
          t={t}
        />
      ) : null}
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
    <form onSubmit={onSubmit} className="p-5 grid md:grid-cols-2 gap-4">
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
      {patch.error ? (
        <p role="alert" className="md:col-span-2 text-sm text-[var(--color-laque-bright)]">
          {patch.error.message}
        </p>
      ) : null}
      <div className="md:col-span-2 flex items-center gap-3 justify-end">
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

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="create-user-dialog-title"
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm"
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-md space-y-4"
        style={{ boxShadow: "0 40px 90px -40px color-mix(in oklab, var(--color-noir-deep) 85%, transparent)" }}
      >
        <header className="mb-2">
          <p className="micro">{t("admin.users.new.subtitle")}</p>
          <h2 id="create-user-dialog-title" className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("admin.users.new")}
          </h2>
          <div className="gold-rule w-16 mt-3" />
        </header>
        <FormField label={t("register.field.username")} value={username} onChange={setUsername} required />
        <FormField label={t("register.field.display_name")} value={displayName} onChange={setDisplayName} />
        <FormField label={t("register.field.email")} type="email" value={email} onChange={setEmail} />
        <FormField label={t("register.field.password")} type="password" value={password} onChange={setPassword} required />
        <label className="flex items-center gap-3 text-sm text-[var(--color-ivoire)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="accent-[var(--color-or)] w-4 h-4"
          />
          <span>{t("admin.users.new.is_admin")}</span>
        </label>
        {create.error ? (
          <p role="alert" className="text-sm text-[var(--color-laque-bright)]">
            {create.error.message}
          </p>
        ) : null}
        <div className="flex items-center gap-3 justify-end pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={create.isPending}>
            {t("admin.users.new.create")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({ title, body, onConfirm, onCancel, loading, danger, t }) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="confirm-dialog-title"
      onClick={onCancel}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-md"
        style={{ boxShadow: "0 40px 90px -40px color-mix(in oklab, var(--color-noir-deep) 85%, transparent)" }}
      >
        <h2 id="confirm-dialog-title" className="display text-xl text-[var(--color-ivoire)]">{title}</h2>
        <p className="mt-3 text-[var(--color-ivoire-soft)]">{body}</p>
        <div className="flex items-center gap-3 justify-end mt-6">
          <Button variant="ghost" onClick={onCancel}>
            {t("editor.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={loading}
            className={danger ? "!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]" : ""}
          >
            {t("admin.users.confirm_delete.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
