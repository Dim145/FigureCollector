import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFigures } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import FormField from "../components/FormField.jsx";
import Select from "../components/Select.jsx";

const TYPE_OPTIONS = [
  "",
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

export default function BrowsePage() {
  const t = useT();
  const me = useMe();
  const [q, setQ] = useState("");
  const [figureType, setFigureType] = useState("");

  const figures = useFigures({
    q: q.trim() || undefined,
    figure_type: figureType || undefined,
  });

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{t("browse.subtitle")}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("browse.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        <Card className="p-5 mb-8">
          <div className="grid sm:grid-cols-[2fr_1fr] gap-4">
            <FormField
              label={t("nav.search")}
              value={q}
              onChange={setQ}
              placeholder={t("browse.search_placeholder")}
            />
            <Select
              label={t("browse.filter_type")}
              value={figureType}
              onChange={setFigureType}
              options={TYPE_OPTIONS.map((v) => ({
                value: v,
                label: v ? t(`type.${v}`) : t("browse.filter_all"),
              }))}
            />
          </div>
        </Card>

        {figures.data?.length === 0 ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-12">
            {t("browse.empty")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {figures.data?.map((f) => (
              <li key={f.id}>
                <FigureCard
                  figureId={f.id}
                  href={`/figures/${f.id}`}
                  name={f.name}
                  type={f.figure_type}
                  manufacturer={null}
                  imageUrl={f.official_image_url}
                  scale={f.scale}
                  heightMm={f.height_mm}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
