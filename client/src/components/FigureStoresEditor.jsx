import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import {
  useAddFigureToStore,
  useRemoveFigureFromStore,
  useStores,
  useStoresForFigure,
} from "../hooks/useStores.js";
import { buildBuyUrl } from "../lib/storeLink.js";
import StoreAutocomplete from "./StoreAutocomplete.jsx";

/**
 * Admin-only section embedded inside the FigureForm when editing an
 * existing figure. Lets the admin curate the `figure_stores` M2M:
 *
 *   - current links rendered as chips with × to remove and ✎ to set/edit the
 *     per-store buy link (the product page's path+query — the host lives on
 *     the store row)
 *   - StoreAutocomplete + optional link field to pick an existing store and
 *     link it, optionally with a buy link in one go
 *
 * Creating a new store is intentionally NOT exposed here — the
 * /admin/stores page is the place to create stores. If the admin types
 * a name that doesn't exist in the registry, the form shows a hint to
 * use that page instead. (Provider imports DO auto-create stores; that's a
 * separate flow in figure::create.)
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
  const [newLink, setNewLink] = useState("");
  const [hint, setHint] = useState(null);
  // id of the linked store whose buy link is being edited inline, + its draft.
  const [editingId, setEditingId] = useState(null);
  const [linkDraft, setLinkDraft] = useState("");

  const linkedList = linked.data ?? [];

  // Reset transient hints + close the inline editor when the linked set
  // changes (server confirmed our last mutation).
  useEffect(() => {
    setHint(null);
    setEditingId(null);
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
    if (linkedList.some((s) => s.id === match.id)) {
      setHint(t("figure.form.stores.already"));
      return;
    }
    await add.mutateAsync({
      storeId: match.id,
      figureId,
      link: newLink.trim() || null,
    });
    setPick("");
    setNewLink("");
  };

  const startEdit = (s) => {
    setEditingId(s.id);
    setLinkDraft(s.link ?? "");
  };

  const saveLink = async () => {
    await add.mutateAsync({
      storeId: editingId,
      figureId,
      link: linkDraft.trim() || null,
    });
  };

  const clearLink = async () => {
    await add.mutateAsync({ storeId: editingId, figureId, link: null });
  };

  const editing = linkedList.find((s) => s.id === editingId) ?? null;

  return (
    <div className="figure-stores-editor">
      <p className="ftype-form-eyebrow">店 · {t("figure.form.stores.title")}</p>
      <p className="figure-stores-editor-hint">{t("figure.form.stores.help")}</p>

      {linkedList.length > 0 ? (
        <ul className="figure-stores-chips">
          {linkedList.map((s) => {
            const buyHref = buildBuyUrl(s.url, s.link);
            return (
              <li key={s.id}>
                <span
                  className={`figure-stores-chip${s.link ? " has-link" : ""}`}
                >
                  <span className="figure-stores-chip-name">{s.name}</span>
                  {buyHref ? (
                    <a
                      href={buyHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="figure-stores-chip-link"
                      title={buyHref}
                      aria-label={t("figure.form.stores.link_has")}
                    >
                      ↗
                    </a>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => startEdit(s)}
                    className="figure-stores-chip-edit"
                    aria-label={t("figure.form.stores.link_edit")}
                    title={t("figure.form.stores.link_edit")}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutateAsync({ storeId: s.id, figureId })}
                    disabled={remove.isPending}
                    className="figure-stores-chip-x"
                    aria-label={t("figure.form.stores.remove", { name: s.name })}
                    title={t("figure.form.stores.remove", { name: s.name })}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="figure-stores-empty">{t("figure.form.stores.empty")}</p>
      )}

      {editing ? (
        <div className="figure-stores-link-editor">
          <label className="figure-stores-link-editor-label">
            {t("figure.form.stores.link_editing", { name: editing.name })}
          </label>
          <input
            type="text"
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            placeholder={t("figure.form.stores.link_ph")}
            className="figure-stores-link-input"
            autoFocus
          />
          <div className="figure-stores-link-editor-actions">
            <button
              type="button"
              onClick={saveLink}
              disabled={add.isPending}
              className="figure-stores-add-btn"
            >
              {t("figure.form.stores.link_save")}
            </button>
            {editing.link ? (
              <button
                type="button"
                onClick={clearLink}
                disabled={add.isPending}
                className="figure-stores-link-clear"
              >
                {t("figure.form.stores.link_clear")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="figure-stores-link-clear"
            >
              {t("editor.cancel")}
            </button>
          </div>
        </div>
      ) : null}

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
      <input
        type="text"
        value={newLink}
        onChange={(e) => setNewLink(e.target.value)}
        placeholder={t("figure.form.stores.link_label")}
        className="figure-stores-link-input figure-stores-add-link"
        aria-label={t("figure.form.stores.link_label")}
      />

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
