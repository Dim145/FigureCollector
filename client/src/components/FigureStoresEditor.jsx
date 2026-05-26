import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAddFigureToStore,
  useRemoveFigureFromStore,
  useStores,
  useStoresForFigure,
} from "../hooks/useStores.js";
import StoreAutocomplete from "./StoreAutocomplete.jsx";

/**
 * Admin-only section embedded inside the FigureForm when editing an
 * existing figure. Lets the admin curate the `figure_stores` M2M:
 *
 *   - current links rendered as chips with × to remove
 *   - StoreAutocomplete to pick an existing store and link it
 *
 * Creating a new store is intentionally NOT exposed here — the
 * /admin/stores page is the place to create stores. If the admin types
 * a name that doesn't exist in the registry, the form shows a hint to
 * use that page instead.
 *
 * Reminder: removing a link only sticks until the next owned_item or
 * preorder write rebinds the pair via the `*_sync_store` triggers.
 */
export default function FigureStoresEditor({ figureId }) {
  const t = useT();
  const stores = useStores();
  const linked = useStoresForFigure(figureId);
  const add = useAddFigureToStore();
  const remove = useRemoveFigureFromStore();

  const [pick, setPick] = useState("");
  const [hint, setHint] = useState(null);

  // Reset transient hints when the linked set changes (server confirmed
  // our last mutation).
  useEffect(() => {
    setHint(null);
  }, [linked.data]);

  const onAdd = async () => {
    const name = pick.trim();
    if (!name) return;
    const match = (stores.data ?? []).find(
      (s) => s.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (!match) {
      setHint(t("figure.form.stores.unknown"));
      return;
    }
    if ((linked.data ?? []).some((s) => s.id === match.id)) {
      setHint(t("figure.form.stores.already"));
      return;
    }
    await add.mutateAsync({ storeId: match.id, figureId });
    setPick("");
  };

  const linkedList = linked.data ?? [];

  return (
    <div className="figure-stores-editor">
      <p className="ftype-form-eyebrow">店 · {t("figure.form.stores.title")}</p>
      <p className="figure-stores-editor-hint">
        {t("figure.form.stores.help")}
      </p>

      {linkedList.length > 0 ? (
        <ul className="figure-stores-chips">
          {linkedList.map((s) => (
            <li key={s.id}>
              <span className="figure-stores-chip">
                <span className="figure-stores-chip-name">{s.name}</span>
                <button
                  type="button"
                  onClick={() =>
                    remove.mutateAsync({ storeId: s.id, figureId })
                  }
                  disabled={remove.isPending}
                  className="figure-stores-chip-x"
                  aria-label={t("figure.form.stores.remove", { name: s.name })}
                  title={t("figure.form.stores.remove", { name: s.name })}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="figure-stores-empty">{t("figure.form.stores.empty")}</p>
      )}

      <div className="figure-stores-add">
        <StoreAutocomplete
          label={t("figure.form.stores.add_label")}
          value={pick}
          onChange={(v) => {
            setPick(v);
            setHint(null);
          }}
          placeholder={t("figure.form.stores.add_ph")}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!pick.trim() || add.isPending}
          className="figure-stores-add-btn"
        >
          + {t("figure.form.stores.add_btn")}
        </button>
      </div>
      {hint ? (
        <p role="alert" className="figure-stores-error">
          {hint}
        </p>
      ) : null}
      {add.isError || remove.isError ? (
        <p role="alert" className="figure-stores-error">
          {(add.error ?? remove.error)?.message}
        </p>
      ) : null}
    </div>
  );
}
