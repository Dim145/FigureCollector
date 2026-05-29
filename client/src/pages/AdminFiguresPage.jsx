import { useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useAdminFigures, useDeleteFigure } from "../hooks/useAdmin.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";

export default function AdminFiguresPage() {
  const t = useT();
  const [q, setQ] = useState("");
  const figures = useAdminFigures({ q });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const del = useDeleteFigure();

  const onDelete = async () => {
    if (!deleting) return;
    await del.mutateAsync(deleting.id);
    setDeleting(null);
  };

  return (
    <div>
      <header className="mb-6">
        <p className="micro">{t("admin.figures.subtitle")}</p>
        <input
          type="text"
          value={q}
          placeholder={t("admin.figures.search")}
          aria-label={t("admin.figures.search")}
          onChange={(e) => setQ(e.target.value)}
          className="mt-3 w-full md:max-w-md bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-2 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
        />
      </header>

      {figures.isLoading ? (
        <p className="text-center text-[var(--color-ivoire-soft)]">…</p>
      ) : figures.data?.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] border-b border-[var(--color-or)]/15">
                <th className="px-4 py-3 font-normal">{t("admin.figures.col.name")}</th>
                <th className="px-4 py-3 font-normal">{t("admin.figures.col.type")}</th>
                <th className="px-4 py-3 font-normal">{t("admin.figures.col.scale")}</th>
                <th className="px-4 py-3 font-normal">{t("admin.figures.col.created")}</th>
                <th className="px-4 py-3 font-normal text-right">
                  {t("admin.users.col.actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {figures.data.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-[var(--color-or)]/10 hover:bg-[var(--color-or)]/5 transition-colors"
                >
                  <td className="px-4 py-3 align-middle">
                    <Link
                      to={`/figures/${f.id}`}
                      className="text-[var(--color-ivoire)] hover:text-[var(--color-or)] transition-colors"
                    >
                      {f.name}
                    </Link>
                    {f.version_name ? (
                      <span className="block text-[10px] text-[var(--color-or-pale)]/70 mt-0.5">
                        {f.version_name}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)]">
                      {t(`type.${f.figure_type}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle text-[var(--color-ivoire-soft)] text-xs">
                    {f.scale ?? "—"}
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <span className="text-[10px] font-mono tracking-wider text-[var(--color-ivoire-soft)]/70">
                      {new Date(f.created_at).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-middle text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => setEditing(f)}
                        title={t("admin.figures.action.edit")}
                        className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xs px-2 py-1 transition-colors"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(f)}
                        title={t("admin.figures.action.delete")}
                        className="tap-target text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] text-xs px-2 py-1 transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <p className="text-center text-[var(--color-ivoire-soft)] italic">
          {t("browse.empty")}
        </p>
      )}

      {editing ? (
        <FigureEditDialog
          figure={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {deleting ? (
        <div
          role="dialog"
          aria-modal
          aria-labelledby="figures-delete-dialog-title"
          onClick={() => setDeleting(null)}
          className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-md"
          >
            <h2 id="figures-delete-dialog-title" className="display text-xl text-[var(--color-ivoire)]">
              {t("admin.figures.confirm_delete.title", { name: deleting.name })}
            </h2>
            <p className="mt-3 text-[var(--color-ivoire-soft)]">
              {t("admin.figures.confirm_delete.body")}
            </p>
            <div className="flex items-center gap-3 justify-end mt-6">
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                {t("editor.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={onDelete}
                loading={del.isPending}
                className="!bg-[var(--color-laque-bright)] hover:!bg-[var(--color-laque)] !text-[var(--color-ivoire)]"
              >
                {t("admin.users.confirm_delete.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
