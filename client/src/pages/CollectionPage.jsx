import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useOwnedItems, useRemoveOwnedItem } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";

export default function CollectionPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const remove = useRemoveOwnedItem();

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="text-center mb-10">
          <p className="micro">{t("collection.subtitle")}</p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("collection.title")}
          </h1>
          <div className="gold-rule mx-auto w-32 mt-6" />
          {owned.data?.length ? (
            <p className="micro mt-4">
              {t("collection.count", { n: owned.data.length })}
            </p>
          ) : null}
        </header>

        {owned.data?.length === 0 ? (
          <EmptyState t={t} />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {owned.data?.map((item) => (
              <li key={item.id} className="relative">
                <FigureCard
                  figureId={item.figure_id}
                  href={`/figures/${item.figure_id}`}
                  name={item.figure_name}
                  type={item.figure_type}
                  manufacturer={item.manufacturer_name}
                  imageUrl={item.figure_image}
                  scale={item.scale}
                  heightMm={item.height_mm}
                />
                <div className="mt-3 flex items-center justify-between gap-3 px-1">
                  <span className="micro">
                    {t(`condition.${item.condition}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(t("collection.remove") + " ?")) {
                        remove.mutate(item.id);
                      }
                    }}
                    disabled={remove.isPending}
                    className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-laque-bright)] transition-colors disabled:opacity-50"
                  >
                    {t("collection.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

function EmptyState({ t }) {
  return (
    <Card className="max-w-lg mx-auto p-10 text-center">
      <p className="display text-2xl text-[var(--color-ivoire)]">
        {t("collection.empty.title")}
      </p>
      <p className="mt-3 text-[var(--color-ivoire-soft)]">
        {t("collection.empty.body")}
      </p>
      <div className="gold-rule mx-auto w-24 my-6" />
      <Link to="/figures/new">
        <Button variant="primary">{t("collection.empty.cta")}</Button>
      </Link>
    </Card>
  );
}
