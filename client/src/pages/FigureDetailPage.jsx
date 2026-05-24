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
import CoverPicker from "../components/CoverPicker.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import FigureHero from "../components/FigureHero.jsx";
import FigurePhotosSection from "../components/FigurePhotosSection.jsx";
import PhotoStrip from "../components/PhotoStrip.jsx";
import PreorderHistory from "../components/PreorderHistory.jsx";
import TurntableSection from "../components/TurntableSection.jsx";
import { nsfwBlocked, nsfwClass } from "../lib/nsfw.js";

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
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState(false);

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
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";

  const onAdd = () => {
    addOwned.mutate({ figure_id: f.id });
  };

  const onDelete = async () => {
    await del.mutateAsync(f.id);
    setConfirming(false);
    navigate("/browse");
  };

  // Direct-URL NSFW interstitial — admins always bypass (moderation),
  // and the user can choose to override for this session via the button.
  if (nsfwBlocked(f.is_nsfw, nsfwPref) && !isAdmin && !nsfwAcknowledged) {
    return (
      <AppShell>
        <NsfwInterstitial
          t={t}
          figureId={f.id}
          onAcknowledge={() => setNsfwAcknowledged(true)}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="relative pb-24">
        {/* ───────── Hero band: full-bleed photo with kanji watermark ───────── */}
        <section className="relative">
          {/* Ambient kanji backdrop */}
          <span
            aria-hidden
            className="kanji-mark text-[28rem] -top-8 -left-12 hidden md:block"
          >
            {kanjiForType(f.figure_type)}
          </span>

          <div className="relative max-w-7xl mx-auto px-6 pt-16 grid md:grid-cols-[1.05fr_1fr] gap-10 lg:gap-16 items-start">
            {/* Hero gallery — catalog photos + (if owned) my photos */}
            <FigureHero
              figure={f}
              ownedItemId={ownedRecord?.id ?? null}
              figureTypeKanji={kanjiForType(f.figure_type)}
              nsfwBlurClass={nsfwClass(f.is_nsfw, nsfwPref)}
            />

            {/* Right column: title + specs + CTA */}
            <div className="relative pt-2">
              {/* Edit / Delete cluster */}
              {canEdit ? (
                <div className="absolute -top-2 right-0 flex flex-col items-end gap-2 text-[10px] uppercase tracking-[0.22em] reveal" style={{ "--i": 1 }}>
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

              <p className="micro reveal" style={{ "--i": 2 }}>
                {t(`type.${f.figure_type}`)}
              </p>
              <h1
                className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
                style={{ "--i": 3 }}
              >
                {f.name}
              </h1>
              {f.version_name ? (
                <p
                  className="display-italic text-2xl mt-2 text-[var(--color-or)] reveal"
                  style={{ "--i": 4 }}
                >
                  {f.version_name}
                </p>
              ) : null}

              <div className="gold-rule w-32 my-8 reveal" style={{ "--i": 5 }} />

              {/* Description (if any) */}
              {f.description ? (
                <p
                  className="text-[var(--color-ivoire-soft)] leading-relaxed mb-8 reveal"
                  style={{ "--i": 6 }}
                >
                  {f.description}
                </p>
              ) : null}

              {/* Museum-label spec list */}
              <dl className="reveal" style={{ "--i": 7 }}>
                <MuseumRow
                  label={t("figure.spec.manufacturer")}
                  value={f.manufacturer_name}
                  href={
                    f.manufacturer_slug
                      ? `/manufacturers/${f.manufacturer_slug}`
                      : null
                  }
                />
                <MuseumRow
                  label={t("figure.spec.sculptor")}
                  value={f.sculptor_name}
                />
                <MuseumRow
                  label={t("figure.spec.series")}
                  value={f.series_name}
                  href={f.series_slug ? `/series/${f.series_slug}` : null}
                />
                <MuseumRow
                  label={t("figure.spec.character")}
                  value={f.character_name}
                  href={
                    f.character_slug ? `/characters/${f.character_slug}` : null
                  }
                />
                <MuseumRow label={t("figure.spec.scale")} value={f.scale} />
                <MuseumRow
                  label={t("figure.spec.height")}
                  value={f.height_mm ? `${f.height_mm} mm` : null}
                />
                <MuseumRow
                  label={t("figure.spec.materials")}
                  value={f.materials?.length ? f.materials.join(" · ") : null}
                />
                <MuseumRow label={t("figure.spec.release")} value={f.release_date} />
                <MuseumRow
                  label={t("figure.spec.msrp")}
                  value={
                    f.msrp_amount
                      ? `${f.msrp_amount} ${f.msrp_currency ?? ""}`.trim()
                      : null
                  }
                />
                <MuseumRow label={t("figure.spec.jan")} value={f.jan} mono />
                <MuseumRow label={t("figure.spec.edition")} value={f.edition} />
                <MuseumRow
                  label={t("figure.spec.exclusivity")}
                  value={f.exclusivity}
                />
                <MuseumRow
                  label={t("figure.spec.version")}
                  value={f.version_name}
                />
              </dl>

              {/* CTA */}
              <div className="mt-10 reveal" style={{ "--i": 8 }}>
                {alreadyOwned ? (
                  <div className="flex items-center gap-3 px-5 py-4 border border-[var(--color-or)]/40 bg-[var(--color-or)]/5">
                    <span
                      aria-hidden
                      className="w-2 h-2 bg-[var(--color-or)] rotate-45"
                      style={{ boxShadow: "0 0 10px var(--color-or)" }}
                    />
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
          </div>
        </section>

        {/* ───────── Catalog photos (shared across users) ───────── */}
        <section className="max-w-7xl mx-auto px-6 mt-16">
          <FigurePhotosSection
            figureId={f.id}
            canEdit={canEdit}
            uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
            blurImages={f.is_nsfw && nsfwPref === "blur"}
          />
        </section>

        {/* ───────── Owner-only sections ───────── */}
        {ownedRecord ? (
          <section className="max-w-7xl mx-auto px-6 mt-20">
            <div className="ornate-rule mb-12 max-w-md mx-auto">
              <span aria-hidden className="ornate-rule__diamond" />
            </div>

            {/* Preorder history — only renders when a linked preorder exists */}
            <div className="mb-16">
              <PreorderHistory ownedId={ownedRecord.id} />
            </div>

            <div className="mb-16">
              <PhotoStrip
                ownedId={ownedRecord.id}
                uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
                blurImages={f.is_nsfw && nsfwPref === "blur"}
              />
            </div>

            {/* Cover picker — feeds the thumbnail shown in CollectionPage */}
            <div className="mb-16">
              <header className="flex items-baseline justify-between mb-4">
                <div>
                  <p className="micro">{t("collection.cover.eyebrow")}</p>
                  <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
                    {t("collection.cover.title")}
                  </h2>
                </div>
              </header>
              <CoverPicker owned={ownedRecord} />
            </div>

            <div className="ornate-rule mb-12 max-w-md mx-auto">
              <span aria-hidden className="ornate-rule__diamond" />
            </div>

            <div>
              <TurntableSection ownedId={ownedRecord.id} />
            </div>
          </section>
        ) : null}

        {/* ───────── Modals ───────── */}
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
      </main>
    </AppShell>
  );
}

function MuseumRow({ label, value, mono = false, href = null }) {
  if (!value) return null;
  const inner = href ? (
    <Link
      to={href}
      className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors underline decoration-[var(--color-or)]/30 underline-offset-4 hover:decoration-[var(--color-or)]"
    >
      {value}
    </Link>
  ) : (
    value
  );
  return (
    <div className="museum-row">
      <span className="museum-key">{label}</span>
      <span
        className={`museum-value ${
          mono ? "font-mono tracking-wider text-sm" : ""
        }`}
      >
        {inner}
      </span>
    </div>
  );
}

function kanjiForType(type) {
  switch (type) {
    case "nendoroid":  return "童";
    case "scale":      return "像";
    case "figma":      return "動";
    case "prize":      return "賞";
    case "trading":    return "交";
    case "statue":     return "彫";
    case "plamo":      return "組";
    case "bishoujo":   return "美";
    case "dakimakura": return "枕";
    default:           return "玩";
  }
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

function NsfwInterstitial({ t, figureId, onAcknowledge }) {
  return (
    <main className="relative max-w-xl mx-auto px-6 py-24 text-center">
      <span
        aria-hidden
        className="kanji-mark text-[18rem] -top-12 left-1/2 -translate-x-1/2 select-none"
      >
        禁
      </span>
      <p className="micro relative">{t("nsfw.gate.eyebrow")}</p>
      <h1 className="display text-4xl text-[var(--color-ivoire)] mt-3 relative">
        {t("nsfw.gate.title")}
      </h1>
      <p className="mt-4 text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("nsfw.gate.body")}
      </p>
      {figureId ? (
        <p className="mt-3 font-mono text-[10px] tracking-wider text-[var(--color-or-pale)]/50 break-all relative">
          {figureId}
        </p>
      ) : null}
      <div className="ornate-rule mx-auto w-32 my-8 relative">
        <span aria-hidden className="ornate-rule__diamond" />
      </div>
      <div className="flex flex-col items-stretch gap-3 relative">
        <button
          type="button"
          onClick={onAcknowledge}
          className="px-5 py-3 bg-[var(--color-or)] text-[var(--color-noir)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or-pale)] transition-colors"
        >
          {t("nsfw.gate.cta_show")}
        </button>
        <Link
          to="/settings"
          className="px-5 py-3 border border-[var(--color-or)]/40 text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.2em] hover:bg-[var(--color-or)]/10 transition-colors"
        >
          {t("nsfw.gate.cta_settings")}
        </Link>
        <Link
          to="/browse"
          className="px-5 py-3 text-[var(--color-ivoire-soft)] text-[10px] uppercase tracking-[0.22em] hover:text-[var(--color-or)] transition-colors"
        >
          {t("figure.missing.cta_browse")}
        </Link>
      </div>
    </main>
  );
}
