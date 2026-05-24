import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useAddOwnedItem, useCreateFigure } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";
import Select from "../components/Select.jsx";
import { mapApiError } from "../lib/errorMap.js";

const TYPE_OPTIONS = [
  "nendoroid",
  "scale",
  "figma",
  "prize",
  "trading",
  "statue",
  "plamo",
  "bishoujo",
  "dakimakura",
  "other",
];

const CURRENCY_OPTIONS = ["JPY", "EUR", "USD", "GBP", "CHF", "CAD"];

export default function AddFigurePage() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const createFigure = useCreateFigure();
  const addOwned = useAddOwnedItem();

  const [form, setForm] = useState({
    name: "",
    manufacturer_name: "",
    sculptor_name: "",
    series_name: "",
    character_name: "",
    figure_type: "nendoroid",
    scale: "",
    height_mm: "",
    materials: "",
    release_date: "",
    msrp_amount: "",
    msrp_currency: "JPY",
    jan: "",
    edition: "",
    version_name: "",
  });
  const [alsoAddToCollection, setAlsoAddToCollection] = useState(true);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const set = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      manufacturer_name: form.manufacturer_name.trim() || undefined,
      sculptor_name: form.sculptor_name.trim() || undefined,
      series_name: form.series_name.trim() || undefined,
      character_name: form.character_name.trim() || undefined,
      figure_type: form.figure_type,
      scale: form.scale.trim() || undefined,
      height_mm: form.height_mm ? parseInt(form.height_mm, 10) : undefined,
      materials: form.materials
        ? form.materials.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      release_date: form.release_date || undefined,
      msrp_amount: form.msrp_amount || undefined,
      msrp_currency: form.msrp_amount ? form.msrp_currency : undefined,
      jan: form.jan.trim() || undefined,
      edition: form.edition.trim() || undefined,
      version_name: form.version_name.trim() || undefined,
    };

    try {
      const figure = await createFigure.mutateAsync(payload);
      if (alsoAddToCollection) {
        await addOwned.mutateAsync({ figure_id: figure.id });
      }
      navigate(alsoAddToCollection ? "/collection" : `/figures/${figure.id}`);
    } catch {
      // error surfaced via mutation state
    }
  };

  const errorMessage = createFigure.error
    ? mapApiError(createFigure.error, t)
    : addOwned.error
      ? mapApiError(addOwned.error, t)
      : null;

  const isPending = createFigure.isPending || addOwned.isPending;

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{t("nav.add_figure")}</p>
          <h1 className="display text-4xl mt-2 text-[var(--color-ivoire)]">
            {t("addfig.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        <Card className="p-8">
          <form onSubmit={onSubmit} className="space-y-5">
            <FormField
              label={t("addfig.field.name")}
              value={form.name}
              onChange={set("name")}
              required
              disabled={isPending}
            />

            <div className="grid sm:grid-cols-2 gap-5">
              <FormField
                label={t("addfig.field.manufacturer")}
                value={form.manufacturer_name}
                onChange={set("manufacturer_name")}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.sculptor")}
                value={form.sculptor_name}
                onChange={set("sculptor_name")}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.series")}
                value={form.series_name}
                onChange={set("series_name")}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.character")}
                value={form.character_name}
                onChange={set("character_name")}
                disabled={isPending}
              />
              <Select
                label={t("addfig.field.type")}
                value={form.figure_type}
                onChange={set("figure_type")}
                options={TYPE_OPTIONS.map((v) => ({ value: v, label: t(`type.${v}`) }))}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.scale")}
                value={form.scale}
                onChange={set("scale")}
                placeholder="1/7, 1/8, non-scale…"
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.height_mm")}
                type="number"
                value={form.height_mm}
                onChange={set("height_mm")}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.materials")}
                value={form.materials}
                onChange={set("materials")}
                placeholder="PVC, ABS, polystone"
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.release_date")}
                type="date"
                value={form.release_date}
                onChange={set("release_date")}
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.jan")}
                value={form.jan}
                onChange={set("jan")}
                disabled={isPending}
              />
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormField
                    label={t("addfig.field.msrp")}
                    type="number"
                    value={form.msrp_amount}
                    onChange={set("msrp_amount")}
                    disabled={isPending}
                  />
                </div>
                <Select
                  label={t("addfig.field.currency")}
                  value={form.msrp_currency}
                  onChange={set("msrp_currency")}
                  options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                  disabled={isPending}
                />
              </div>
              <FormField
                label={t("addfig.field.edition")}
                value={form.edition}
                onChange={set("edition")}
                placeholder="Standard, Limited…"
                disabled={isPending}
              />
              <FormField
                label={t("addfig.field.version_name")}
                value={form.version_name}
                onChange={set("version_name")}
                placeholder="Snow Princess Ver., Repaint…"
                disabled={isPending}
              />
            </div>

            <label className="flex items-center gap-3 pt-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alsoAddToCollection}
                onChange={(e) => setAlsoAddToCollection(e.target.checked)}
                disabled={isPending}
                className="accent-[var(--color-or)] w-4 h-4"
              />
              <span className="text-sm text-[var(--color-ivoire-soft)]">
                {t("addfig.also_add")}
              </span>
            </label>

            {errorMessage ? (
              <p
                role="alert"
                className="text-sm text-[var(--color-laque-bright)] tracking-wide border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
              >
                {errorMessage}
              </p>
            ) : null}

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="submit"
                variant="primary"
                loading={isPending}
              >
                {t("addfig.submit")}
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </AppShell>
  );
}
