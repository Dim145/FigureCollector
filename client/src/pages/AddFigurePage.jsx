import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useAddOwnedItem, useCreateFigure } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureForm from "../components/FigureForm.jsx";
import { mapApiError } from "../lib/errorMap.js";

export default function AddFigurePage() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const createFigure = useCreateFigure();
  const addOwned = useAddOwnedItem();
  const [alsoAddToCollection, setAlsoAddToCollection] = useState(true);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const onSubmit = async (payload) => {
    // If the user tags a figure as NSFW while their own pref hides them,
    // warn (but don't block) — they may want to set the pref to "blur" or
    // "show" before they continue, or they might be content uploading for
    // others without seeing it themselves.
    const pref = me.data?.user?.nsfw_visibility ?? "hide";
    if (payload.is_nsfw && pref === "hide") {
      const ok = window.confirm(t("nsfw.warn_on_create"));
      if (!ok) return;
    }
    try {
      const figure = await createFigure.mutateAsync(payload);
      if (alsoAddToCollection) {
        await addOwned.mutateAsync({ figure_id: figure.id });
      }
      navigate(alsoAddToCollection ? "/collection" : `/figures/${figure.id}`);
    } catch {
      /* surfaced via createFigure.error */
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
          <FigureForm
            mode="create"
            onSubmit={onSubmit}
            busy={isPending}
            errorMessage={errorMessage}
            extras={
              <label className="flex items-center gap-3 cursor-pointer select-none">
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
            }
          />
        </Card>
      </main>
    </AppShell>
  );
}
