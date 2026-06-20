import { Link } from "react-router-dom";
import { typeHue, typeKanji } from "../../lib/typeHue.js";
import { standeeWidthPx } from "../../lib/standee.js";

/**
 * To-scale diorama of a public collection — pieces stand on a lit shelf sized
 * by their real height (`height_mm`), so a 1/4 statue towers over a Nendoroid.
 * Reuses the global `.diorama-*` styling + the shared `standeeWidthPx`; each
 * standee links to its figure. Covers are the catalogue images (`figure_image`).
 * GPU-light: static shelf, no animation.
 */
export default function ShowcaseDiorama({ items }) {
  return (
    <div className="diorama-shelf">
      <span aria-hidden className="diorama-spot" />
      <ul className="diorama-row">
        {items.map((e) => (
          <li
            key={e.owned_id}
            className="diorama-standee"
            style={{ "--hue": typeHue(e.figure_type), "--standee-w": `${standeeWidthPx(e)}px` }}
          >
            <Link
              to={`/figures/${e.figure_id}`}
              className="diorama-standee-btn"
              title={e.figure_name}
            >
              <span className="diorama-standee-card">
                {e.figure_image ? (
                  <img src={e.figure_image} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="diorama-standee-ph ja" aria-hidden>
                    {typeKanji(e.figure_type)}
                  </span>
                )}
              </span>
              <span aria-hidden className="diorama-standee-contact" />
              {e.figure_image ? (
                <span aria-hidden className="diorama-standee-reflect">
                  <img src={e.figure_image} alt="" loading="lazy" draggable={false} />
                </span>
              ) : null}
              <span className="diorama-standee-name">{e.figure_name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <span aria-hidden className="diorama-floor" />
    </div>
  );
}
