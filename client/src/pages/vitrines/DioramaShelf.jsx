import { typeHue, typeKanji } from "../../lib/typeHue.js";
import { standeeWidthPx } from "../../lib/standee.js";
import { resolveOwnedCover } from "../../lib/coverUrl.js";

/**
 * Diorama view — read-only display mode. Each vitrine becomes a lit perspective
 * shelf: its specimens stand as framed standees on a warm-spotlit stage, each
 * casting a faint reflection on the polished floor (see `.diorama-*` in
 * index.css). Arranging stays in the grid view; this is the "show it off" mode.
 * Unchanged from the original page beyond extraction.
 */
export default function DioramaShelf({ name, marker, items, nsfwBlur, openItem, t }) {
  return (
    <section className="reveal" aria-label={name}>
      <header className="flex items-baseline justify-between gap-3 px-1 mb-2">
        <h2 className="display text-2xl leading-tight text-[var(--color-ivoire)] truncate">
          {marker ? (
            <span aria-hidden className="ja text-base text-[var(--color-or)] mr-2 align-middle">
              {marker}
            </span>
          ) : null}
          {name}
        </h2>
        <span className="label-mono shrink-0 text-[var(--color-ivoire-soft)]/60">
          {items.length}
          <span aria-hidden className="ja ml-0.5 text-[var(--color-or)]/70">
            点
          </span>
        </span>
      </header>
      <div className="diorama-shelf">
        <span aria-hidden className="diorama-spot" />
        {items.length === 0 ? (
          <p className="diorama-empty">
            <span
              aria-hidden
              className="ja block text-2xl mb-1 text-[color-mix(in_oklab,var(--color-or)_40%,transparent)]"
            >
              空
            </span>
            {t("vitrines.diorama_empty", {
              default: "Étagère vide — range des pièces ici depuis la vue Grille.",
            })}
          </p>
        ) : (
          <ul className="diorama-row">
            {items.map((o) => (
              <DioramaStandee
                key={o.id}
                o={o}
                blur={Boolean(o.is_nsfw && nsfwBlur)}
                onOpen={() => openItem(o)}
              />
            ))}
          </ul>
        )}
        <span aria-hidden className="diorama-floor" />
      </div>
    </section>
  );
}

function DioramaStandee({ o, blur, onOpen }) {
  const cover = resolveOwnedCover(o);
  return (
    <li
      className="diorama-standee"
      style={{ "--hue": typeHue(o.figure_type), "--standee-w": `${standeeWidthPx(o)}px` }}
    >
      <button type="button" className="diorama-standee-btn" onClick={onOpen} title={o.figure_name}>
        <span className="diorama-standee-card">
          {cover ? (
            <img
              src={cover}
              alt=""
              loading="lazy"
              draggable={false}
              className={blur ? "nsfw-blur" : ""}
            />
          ) : (
            <span className="diorama-standee-ph ja" aria-hidden>
              {typeKanji(o.figure_type)}
            </span>
          )}
        </span>
        <span aria-hidden className="diorama-standee-contact" />
        {cover ? (
          <span aria-hidden className="diorama-standee-reflect">
            <img
              src={cover}
              alt=""
              loading="lazy"
              draggable={false}
              className={blur ? "nsfw-blur" : ""}
            />
          </span>
        ) : null}
        <span className="diorama-standee-name">{o.figure_name}</span>
      </button>
    </li>
  );
}
