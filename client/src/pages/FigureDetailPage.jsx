import { Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import {
  useAddOwnedItem,
  useFigure,
  useOwnedItems,
} from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import PhotoStrip from "../components/PhotoStrip.jsx";

export default function FigureDetailPage() {
  const { id } = useParams();
  const t = useT();
  const me = useMe();
  const figure = useFigure(id);
  const owned = useOwnedItems();
  const addOwned = useAddOwnedItem();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (figure.isLoading) return <AppShell><LoadingState /></AppShell>;
  if (!figure.data) return <AppShell><MissingState t={t} /></AppShell>;

  const f = figure.data;
  const ownedRecord = owned.data?.find((o) => o.figure_id === f.id);
  const alreadyOwned = !!ownedRecord;

  const onAdd = () => {
    addOwned.mutate({ figure_id: f.id });
  };

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-6 py-12">
        <header className="mb-8">
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
        </header>

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
          <div className="mt-12 pt-8 border-t border-[var(--color-or)]/15">
            <PhotoStrip ownedId={ownedRecord.id} />
          </div>
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

function MissingState({ t }) {
  return (
    <div className="max-w-md mx-auto px-6 py-16 text-center">
      <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
      <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("error.unknown")}</p>
    </div>
  );
}
