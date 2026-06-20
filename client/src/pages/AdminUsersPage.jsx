import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
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
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  IconButton,
  Modal,
  Pagination,
  StatCard,
} from "../components/ui/index.js";
import BulkActionBar from "../components/BulkActionBar.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FormField from "../components/FormField.jsx";
import AdminSectionHeader from "./admin/AdminSectionHeader.jsx";
import { selectionBridge } from "./admin/selectionBridge.js";
import { useClientSort } from "./admin/useClientSort.js";
import { useClientPagination } from "./admin/useClientPagination.js";

/**
 * /admin/users — the account register, on the shared foundation.
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * nav already sit above. This view is an editorial *section* of the admin
 * surface: AdminSectionHeader (kicker · 衆 · COMPTES) with the single primary
 * "New user" CTA, a four-up StatCard strip derived from the loaded rows, then
 * the roster as the shared <DataTable> — sortable columns, row-selection wired
 * to the existing `useRowSelection` + floating BulkActionBar, a shared
 * EmptyState, and client-side Pagination keeping a long roster legible.
 *
 * Edit + create open the shared <Modal>; delete routes through ConfirmDialog.
 * Data + mutations are unchanged (useAdminUsers + patch/delete/bulk/create) and
 * the self-delete guard is preserved: the current admin's own row can't be
 * selected (bridge `allowed` set) and its delete action is disabled.
 */
export default function AdminUsersPage() {
  const t = useT();
  const users = useAdminUsers();
  const me = useMe();
  const myId = me.data?.user?.id;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // user row | null
  const [deleting, setDeleting] = useState(null); // user row | null
  const bulkDel = useBulkDeleteUsers();
  const del = useDeleteAdminUser();
  const patch = usePatchAdminUser();

  const rows = useMemo(() => users.data ?? [], [users.data]);

  // Selectable rows exclude yourself — the server refuses to delete the caller
  // anyway, so keep it out of the selection set entirely.
  const selectableIds = useMemo(
    () => rows.filter((u) => u.id !== myId).map((u) => u.id),
    [rows, myId],
  );
  const allowed = useMemo(() => new Set(selectableIds), [selectableIds]);
  const sel = useRowSelection(selectableIds);

  // Roster roll-ups — derived purely from the loaded rows (no extra fetch).
  // Gold marks the catalogue total (owned pieces), --primary flags the
  // privileged admin count, per the playbook.
  const adminCount = rows.filter((u) => u.is_admin).length;
  const ownedTotal = rows.reduce((n, u) => n + (u.owned_count ?? 0), 0);
  const figureTotal = rows.reduce((n, u) => n + (u.figure_count ?? 0), 0);
  const stats = [
    { label: t("admin.users.col.username"), value: rows.length },
    { label: t("admin.users.role.admin"), value: adminCount, tone: "red" },
    { label: t("admin.users.col.owned"), value: ownedTotal, tone: "gold" },
    { label: t("admin.users.col.figures"), value: figureTotal },
  ];

  const { sort, onSort, sortedRows } = useClientSort(
    rows,
    {
      username: (u) => u.username?.toLowerCase(),
      email: (u) => u.email?.toLowerCase(),
      role: (u) => (u.is_admin ? 1 : 0),
      owned_count: (u) => u.owned_count ?? 0,
      figure_count: (u) => u.figure_count ?? 0,
      created_at: (u) => new Date(u.created_at).getTime(),
    },
    { key: "created_at", dir: "desc" },
  );
  const { page, setPage, pageCount, pageRows } = useClientPagination(sortedRows, 20);

  const onDelete = async () => {
    if (!deleting) return;
    await del.mutateAsync(deleting.id);
    setDeleting(null);
  };

  const nf = (n) => Number(n ?? 0).toLocaleString(appLocale());

  const columns = [
    {
      key: "username",
      header: t("admin.users.col.username"),
      sortable: true,
      render: (u) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-[var(--on-surface)]">{u.username}</span>
          {u.id === myId ? (
            <Badge tone="danger" className="!text-[9px] !tracking-[0.2em]">
              {t("admin.users.tag.you")}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "email",
      header: t("admin.users.col.email"),
      sortable: true,
      render: (u) => <span className="text-[var(--on-surface-muted)]">{u.email ?? "—"}</span>,
    },
    {
      key: "role",
      header: t("admin.users.col.role"),
      sortable: true,
      render: (u) =>
        u.is_admin ? (
          <Badge tone="gold">
            <span aria-hidden className="ja not-italic text-[11px] leading-none">
              管
            </span>
            {t("admin.users.role.admin")}
          </Badge>
        ) : (
          <span className="text-[var(--on-surface-subtle)] text-xs uppercase tracking-[0.18em]">
            {t("admin.users.role.user")}
          </span>
        ),
    },
    {
      key: "owned_count",
      header: t("admin.users.col.owned"),
      sortable: true,
      align: "right",
      render: (u) => (
        <span className="figural text-base text-[var(--accent)]">{nf(u.owned_count)}</span>
      ),
    },
    {
      key: "figure_count",
      header: t("admin.users.col.figures"),
      sortable: true,
      align: "right",
      render: (u) => (
        <span className="figural text-base text-[var(--accent)]">{nf(u.figure_count)}</span>
      ),
    },
    {
      key: "created_at",
      header: t("admin.users.col.created"),
      sortable: true,
      render: (u) => (
        <span className="text-[10px] font-mono tracking-wider text-[var(--on-surface-subtle)]">
          {new Date(u.created_at).toLocaleDateString(appLocale())}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("admin.users.col.actions"),
      align: "right",
      render: (u) => {
        const mine = u.id === myId;
        return (
          <div className="flex items-center gap-0.5 justify-end">
            <IconButton
              variant="ghost"
              disabled={patch.isPending}
              icon={u.is_admin ? ChevronDown : ChevronUp}
              label={u.is_admin ? t("admin.users.action.demote") : t("admin.users.action.promote")}
              onClick={() => patch.mutateAsync({ id: u.id, patch: { is_admin: !u.is_admin } })}
            />
            <IconButton
              variant="ghost"
              icon={Pencil}
              label={t("admin.users.action.edit")}
              onClick={() => setEditing(u)}
            />
            <IconButton
              variant="ghost"
              disabled={mine}
              icon={Trash2}
              label={
                mine ? t("admin.users.action.cant_delete_self") : t("admin.users.action.delete")
              }
              onClick={() => setDeleting(u)}
              className="hover:!text-[var(--danger)]"
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="relative">
      <AdminSectionHeader
        kanji="衆"
        kicker={t("admin.users.subtitle")}
        label={t("admin.users.kicker_label", { default: "COMPTES" })}
        title={t("admin.tab.users")}
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("admin.users.new")}
          </Button>
        }
      />

      {/* ─── Roster metrics strip ─── */}
      <section
        className="reveal mb-8"
        style={{ "--i": 3 }}
        aria-label={t("admin.users.metrics", { default: "Compteurs des comptes" })}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
          ))}
        </div>
      </section>

      {/* ─── Roster table ─── */}
      <div className="reveal" style={{ "--i": 4 }}>
        <BulkActionBar
          selectedIds={sel.selectedIds}
          onClear={sel.clear}
          onDelete={(idList) => bulkDel.mutateAsync(idList)}
          busy={bulkDel.isPending}
          confirmBody={t("admin.bulk.confirm.body.users", { n: sel.selectedIds.length })}
        />

        <DataTable
          columns={columns}
          rows={pageRows}
          getRowId={(u) => u.id}
          sort={sort}
          onSort={onSort}
          selectable
          selectedIds={sel.selectedIds}
          onSelectionChange={selectionBridge(sel, allowed)}
          loading={users.isLoading}
          empty={
            <EmptyState
              compact
              kanji="人"
              hue="var(--color-indigo)"
              title={t("admin.empty.users.title")}
              body={t("admin.empty.users.body")}
            />
          }
        />

        {pageCount > 1 ? (
          <div className="mt-5 flex justify-center">
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </div>
        ) : null}
      </div>

      {creating ? <CreateUserDialog onClose={() => setCreating(false)} t={t} /> : null}

      {editing ? <EditUserDialog user={editing} onClose={() => setEditing(null)} t={t} /> : null}

      <ConfirmDialog
        open={!!deleting}
        title={t("admin.users.confirm_delete.title", { name: deleting?.display_name })}
        body={t("admin.users.confirm_delete.body")}
        confirmLabel={t("admin.users.confirm_delete.confirm")}
        onConfirm={onDelete}
        onCancel={() => setDeleting(null)}
        busy={del.isPending}
        destructive
      />
    </div>
  );
}

// =============================================================================
// Edit dialog — the inline row editor, lifted into the shared <Modal>. Same
// patch mutation + COALESCE-friendly diffing (only changed fields are sent).
// =============================================================================

function EditUserDialog({ user, onClose, t }) {
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
    <Modal
      open
      onClose={onClose}
      title={t("admin.users.edit.eyebrow", { default: "MODIFIER" })}
      description={user.username}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" type="submit" form="admin-user-edit" loading={patch.isPending}>
            {t("admin.users.save")}
          </Button>
        </>
      }
    >
      <form id="admin-user-edit" onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
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
          <p role="alert" className="md:col-span-2 text-sm text-[var(--danger)]">
            {patch.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

// =============================================================================
// Create dialog — on the shared <Modal>. Same create mutation + payload.
// =============================================================================

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
    <Modal
      open
      onClose={onClose}
      title={t("admin.users.new")}
      description={t("admin.users.new.subtitle")}
      size="md"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="admin-user-create"
            loading={create.isPending}
          >
            {t("admin.users.new.create")}
          </Button>
        </>
      }
    >
      <form id="admin-user-create" onSubmit={onSubmit} className="space-y-4">
        <FormField
          label={t("register.field.username")}
          value={username}
          onChange={setUsername}
          required
        />
        <FormField
          label={t("register.field.display_name")}
          value={displayName}
          onChange={setDisplayName}
        />
        <FormField
          label={t("register.field.email")}
          type="email"
          value={email}
          onChange={setEmail}
        />
        <FormField
          label={t("register.field.password")}
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        <label className="flex items-center gap-3 text-sm text-[var(--on-surface)] cursor-pointer select-none tap-target">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            className="accent-[var(--primary)] w-4 h-4"
          />
          <span>{t("admin.users.new.is_admin")}</span>
        </label>
        {create.error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {create.error.message}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
