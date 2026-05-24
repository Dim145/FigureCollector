import { useState } from "react";
import { useT } from "../i18n/index.jsx";
import { usePatchFigure } from "../hooks/useAdmin.js";
import Button from "./Button.jsx";
import FormField from "./FormField.jsx";

const TYPES = [
  "scale", "nendoroid", "figma", "prize", "trading",
  "statue", "plamo", "bishoujo", "dakimakura", "other",
];

/**
 * Catalog-edit modal. Used from FigureDetailPage when the caller is the
 * creator OR an admin, and from AdminFiguresPage as the row-action.
 *
 * Only sends the fields the user actually changed — backend treats the
 * payload as a partial patch and ignores undefined keys.
 */
export default function FigureEditDialog({ figure, onClose, onSaved }) {
  const t = useT();
  const patch = usePatchFigure();

  const [name, setName] = useState(figure.name ?? "");
  const [type, setType] = useState(figure.figure_type ?? "other");
  const [scale, setScale] = useState(figure.scale ?? "");
  const [heightMm, setHeightMm] = useState(
    figure.height_mm != null ? String(figure.height_mm) : "",
  );
  const [versionName, setVersionName] = useState(figure.version_name ?? "");
  const [edition, setEdition] = useState(figure.edition ?? "");
  const [exclusivity, setExclusivity] = useState(figure.exclusivity ?? "");
  const [releaseDate, setReleaseDate] = useState(figure.release_date ?? "");
  const [msrpAmount, setMsrpAmount] = useState(
    figure.msrp_amount != null ? String(figure.msrp_amount) : "",
  );
  const [msrpCurrency, setMsrpCurrency] = useState(figure.msrp_currency ?? "");
  const [jan, setJan] = useState(figure.jan ?? "");
  const [imageUrl, setImageUrl] = useState(figure.official_image_url ?? "");
  const [description, setDescription] = useState(figure.description ?? "");

  const submit = async (e) => {
    e.preventDefault();
    const body = {};
    const setIfChanged = (key, next, prev) => {
      if (next !== (prev ?? "")) body[key] = next || null;
    };
    setIfChanged("name", name, figure.name);
    if (type !== figure.figure_type) body.figure_type = type;
    setIfChanged("scale", scale, figure.scale);
    if (heightMm !== (figure.height_mm != null ? String(figure.height_mm) : "")) {
      body.height_mm = heightMm ? Number.parseInt(heightMm, 10) : null;
    }
    setIfChanged("version_name", versionName, figure.version_name);
    setIfChanged("edition", edition, figure.edition);
    setIfChanged("exclusivity", exclusivity, figure.exclusivity);
    if (releaseDate !== (figure.release_date ?? "")) {
      body.release_date = releaseDate || null;
    }
    if (msrpAmount !== (figure.msrp_amount != null ? String(figure.msrp_amount) : "")) {
      body.msrp_amount = msrpAmount || null;
    }
    setIfChanged("msrp_currency", msrpCurrency, figure.msrp_currency);
    setIfChanged("jan", jan, figure.jan);
    setIfChanged("official_image_url", imageUrl, figure.official_image_url);
    setIfChanged("description", description, figure.description);

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const updated = await patch.mutateAsync({ id: figure.id, patch: body });
    onSaved?.(updated);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/90 backdrop-blur-sm overflow-y-auto py-10"
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 w-[92vw] max-w-2xl"
        style={{ boxShadow: "0 40px 90px -40px rgba(0,0,0,0.85)" }}
      >
        <header className="mb-6">
          <p className="micro">{t("figure.edit.subtitle")}</p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">
            {t("figure.edit.title")}
          </h2>
          <div className="gold-rule w-16 mt-3" />
        </header>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <FormField label={t("addfigure.name")} value={name} onChange={setName} required />
          </div>
          <label className="block">
            <span className="micro block mb-2">{t("addfigure.type")}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
            >
              {TYPES.map((tt) => (
                <option key={tt} value={tt}>{t(`type.${tt}`)}</option>
              ))}
            </select>
          </label>
          <FormField label={t("figure.spec.scale")} value={scale} onChange={setScale} />
          <FormField label={t("figure.spec.height")} value={heightMm} onChange={setHeightMm} />
          <FormField label="Version" value={versionName} onChange={setVersionName} />
          <FormField label={t("figure.spec.edition")} value={edition} onChange={setEdition} />
          <FormField label={t("figure.spec.exclusivity")} value={exclusivity} onChange={setExclusivity} />
          <FormField label={t("figure.spec.release")} type="date" value={releaseDate} onChange={setReleaseDate} />
          <FormField label={t("figure.spec.msrp")} value={msrpAmount} onChange={setMsrpAmount} />
          <FormField label="Devise" value={msrpCurrency} onChange={setMsrpCurrency} />
          <FormField label={t("figure.spec.jan")} value={jan} onChange={setJan} />
          <div className="md:col-span-2">
            <FormField label={t("addfigure.image")} value={imageUrl} onChange={setImageUrl} />
          </div>
          <div className="md:col-span-2">
            <label className="block">
              <span className="micro block mb-2">{t("addfigure.description")}</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
              />
            </label>
          </div>
        </div>

        {patch.error ? (
          <p role="alert" className="mt-4 text-sm text-[var(--color-laque-bright)]">
            {patch.error.message}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-3 mt-6">
          <Button variant="ghost" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={patch.isPending}>
            {t("admin.users.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
