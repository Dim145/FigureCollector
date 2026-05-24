import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import {
  useAddOwnedItem,
  useFigure,
  useOwnedItems,
} from "../hooks/useCollection.js";
import { useDeleteFigure } from "../hooks/useAdmin.js";
import { ApiError } from "../lib/api.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import PhotoStrip from "../components/PhotoStrip.jsx";
import TurntableSection from "../components/TurntableSection.jsx";

export default function FigureDetailPage() {
  const { id } = useParams();
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const figure = useFigure(id);
  const owned = useOwnedItems();
  const addOwned = useAddOwnedItem();
  const del = useDeleteFigure();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (figure.isLoading) return <AppShell><LoadingState /></AppShell>;
  if (figure.isError) {
    const notFound =
      figure.error instanceof ApiError && figure.error.status === 404;
    return (
      <AppShell>
        {notFound ? (
          <MissingState t={t} figureId={id} />
        ) : (
          <ErrorState t={t} error={figure.error} onRetry={() => figure.refetch()} />
        )}
      </AppShell>
    );
  }
  if (!figure.data) return <AppShell><LoadingState /></AppShell>;

  const f = figure.data;
  const ownedRecord = owned.data?.find((o) => o.figure_id === f.id);
  const alreadyOwned = !!ownedRecord;
  const canEdit = isAdmin || f.created_by === me.data?.user?.id;

  const onAdd = () => {
    addOwned.mutate({ figure_id: f.id });
  };

  const onDelete = async () => {
    await del.mutateAsync(f.id);
    setConfirming(false);
    navigate("/browse");
  };

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-8 flex items-start justify-between gap-6">
          <div className="min-w-0">
            <p className="micro">{t(`type.${f.figure_type}`)}</p>
            <h1 className="display text-4xl md:text-5xl mt-2 text-[var(--color-ivoire)] leading-tight">
              {f.name}
            </h1>
            {f.version_name ? (
              <p className="display-italic text-xl mt-1 text-[var(--color-or)]">
                {f.version_name}
              </p>
            ) : null}
            <div className="gold-rule w-32 mt-6" />
          </div>
          {canEdit ? (
            <div className="shrink-0 flex flex-col items-end gap-2 text-[11px] uppercase tracking-[0.2em]">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-[var(--color-or)] hover:text-[var(--color-or-pale)] transition-colors"
              >
                ✎ {t("figure.edit.cta")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors"
              >
                × {t("figure.edit.delete")}
              </button>
            </div>
          ) : null}
        </header>

        {editing ? (
          <FigureEditDialog figure={f} onClose={() => setEditing(false)} />
        ) : null}

        {confirming ? (
          <div
            role="dialog"
            aria-modal
            onClick={() => setConfirming(false)}
            className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-md"
            >
              <h2 className="display text-xl text-[var(--color-ivoire)]">
                {t("figure.edit.confirm_delete.title", { name: f.name })}
              </h2>
              <p className="mt-3 text-[var(--color-ivoire-soft)]">
                {t("figure.edit.confirm_delete.body")}
              </p>
              <div className="flex items-center gap-3 justify-end mt-6">
                <Button variant="ghost" onClick={() => setConfirming(false)}>
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

        <div className="grid md:grid-cols-[1fr_1fr] gap-10">
          <Card className="aspect-square grid place-items-center p-8">
            {f.official_image_url ? (
              <img
                src={f.official_image_url}
                alt={f.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <FigureSilhouette />
            )}
          </Card>

          <div>
            <h2 className="micro mb-4">{t("figure.specs")}</h2>
            <dl className="space-y-0 text-sm">
              <SpecRow label={t("figure.spec.scale")} value={f.scale} />
              <SpecRow
                label={t("figure.spec.height")}
                value={f.height_mm ? `${f.height_mm} mm` : null}
              />
              <SpecRow
                label={t("figure.spec.materials")}
                value={f.materials?.length ? f.materials.join(" · ") : null}
              />
              <SpecRow label={t("figure.spec.release")} value={f.release_date} />
              <SpecRow
                label={t("figure.spec.msrp")}
                value={
                  f.msrp_amount
                    ? `${f.msrp_amount} ${f.msrp_currency ?? ""}`.trim()
                    : null
                }
              />
              <SpecRow label={t("figure.spec.jan")} value={f.jan} mono />
              <SpecRow label={t("figure.spec.edition")} value={f.edition} />
              <SpecRow label={t("figure.spec.exclusivity")} value={f.exclusivity} />
            </dl>

            <div className="gold-rule my-8" />

            {alreadyOwned ? (
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-[var(--color-or)] rotate-45" />
                <p className="micro">{t("figure.already_owned")}</p>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={onAdd}
                loading={addOwned.isPending}
                className="w-full"
              >
                {t("figure.add_to_collection")}
              </Button>
            )}
          </div>
        </div>

        {ownedRecord ? (
          <>
            <div className="mt-12 pt-8 border-t border-[var(--color-or)]/15">
              <PhotoStrip ownedId={ownedRecord.id} />
            </div>
            <div className="mt-10 pt-8 border-t border-[var(--color-or)]/15">
              <TurntableSection ownedId={ownedRecord.id} />
            </div>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}

function SpecRow({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div
      className="grid grid-cols-[140px_1fr] py-3 border-b border-[var(--color-or)]/15"
      style={{ alignItems: "baseline" }}
    >
      <dt className="micro">{label}</dt>
      <dd
        className={`text-[var(--color-ivoire)] ${
          mono ? "font-mono text-sm tracking-wider" : "display text-lg"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function FigureSilhouette() {
  return (
    <svg viewBox="0 0 200 280" className="w-2/3 h-2/3 text-[var(--color-or)]/40" aria-hidden>
      <ellipse cx="100" cy="262" rx="60" ry="6" fill="currentColor" />
      <path
        d="M 62 175 Q 100 162 138 175 L 150 250 Q 100 258 50 250 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="100" cy="95" r="50" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M 50 100 Q 50 42 100 36 Q 150 42 150 100 Q 130 70 100 72 Q 70 70 50 100 Z"
        fill="currentColor"
        opacity="0.4"
      />
    </svg>
  );
}

function LoadingState() {
  return <div className="max-w-5xl mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)]">…</div>;
}

function MissingState({ t, figureId }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
      <h1 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("figure.missing.title")}
      </h1>
      <p className="mt-3 text-[var(--color-ivoire-soft)] leading-relaxed">
        {t("figure.missing.body")}
      </p>
      {figureId ? (
        <p className="mt-4 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/60 break-all">
          {figureId}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      <div className="flex flex-col items-stretch gap-3">
        <Link
          to="/browse"
          className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
        <Link
          to="/collection"
          className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("figure.missing.cta_collection")}
        </Link>
      </div>
    </div>
  );
}

function ErrorState({ t, error, onRetry }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-laque-bright)]">!</p>
      <h1 className="display text-3xl text-[var(--color-ivoire)] mt-4">
        {t("error.unknown")}
      </h1>
      {error?.message ? (
        <p className="mt-3 text-sm text-[var(--color-ivoire-soft)] italic break-words">
          {error.message}
        </p>
      ) : null}
      <div className="gold-rule mx-auto w-24 my-8" />
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
      >
        {t("figure.missing.cta_retry")}
      </button>
    </div>
  );
}
