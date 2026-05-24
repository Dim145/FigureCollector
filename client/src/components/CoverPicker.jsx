import { useT } from "../i18n/index.jsx";
import { usePhotos } from "../hooks/useProfile.js";
import { useScans } from "../hooks/useScans.js";
import { useSetOwnedCover } from "../hooks/useFigurePhotos.js";

/**
 * Inline UI letting the user pin one of their *own* photos OR a scan as
 * the cover thumbnail for this owned item in their collection grid.
 *
 * Selection rule:
 *  - clicking a thumbnail toggles it. Re-clicking the active one clears.
 *  - photo / scan are mutually exclusive (enforced server-side too).
 *
 * The catalog falls back automatically when nothing is pinned, so the
 * "Réinitialiser" action only ever sends `{ clear: true }`.
 */
export default function CoverPicker({ owned }) {
  const t = useT();
  const photos = usePhotos(owned.id);
  const scans = useScans(owned.id);
  const setCover = useSetOwnedCover(owned.id);

  const photoList = photos.data ?? [];
  const scanList = scans.data ?? [];

  if (photoList.length === 0 && scanList.length === 0) {
    return (
      <p className="text-sm text-[var(--color-ivoire-soft)] italic">
        {t("collection.cover.empty")}
      </p>
    );
  }

  const activePhoto = owned.cover_photo_id;
  const activeScan = owned.cover_scan_id;
  const hasSelection = !!(activePhoto || activeScan);

  return (
    <div>
      <ul className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        {photoList.map((p) => {
          const active = activePhoto === p.id;
          return (
            <li key={p.id} className="shrink-0">
              <button
                type="button"
                onClick={() =>
                  setCover.mutate(
                    active ? { clear: true } : { photo_id: p.id },
                  )
                }
                disabled={setCover.isPending}
                aria-pressed={active}
                className={`relative block w-28 h-28 bg-[var(--color-noir-deep)] border-2 transition-all ${
                  active
                    ? "border-[var(--color-or)]"
                    : "border-[var(--color-or)]/15 hover:border-[var(--color-or)]/60"
                }`}
                style={
                  active
                    ? {
                        boxShadow:
                          "0 0 0 1px var(--color-or), 0 10px 25px -10px rgba(0,0,0,0.6)",
                      }
                    : undefined
                }
              >
                <img
                  src={`/api/photos/${p.id}`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                {active ? (
                  <span
                    className="absolute top-1 right-1 chip chip--solid pointer-events-none"
                    style={{ fontSize: "8.5px", padding: "0.15em 0.45em" }}
                  >
                    ★
                  </span>
                ) : null}
                <span className="absolute bottom-1 left-1.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70">
                  {t("collection.cover.kind.photo")}
                </span>
              </button>
            </li>
          );
        })}
        {scanList.map((s) => {
          const active = activeScan === s.id;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() =>
                  setCover.mutate(
                    active ? { clear: true } : { scan_id: s.id },
                  )
                }
                disabled={setCover.isPending}
                aria-pressed={active}
                className={`relative block w-28 h-28 bg-[var(--color-noir-deep)] border-2 transition-all ${
                  active
                    ? "border-[var(--color-or)]"
                    : "border-[var(--color-or)]/15 hover:border-[var(--color-or)]/60"
                }`}
                style={
                  active
                    ? {
                        boxShadow:
                          "0 0 0 1px var(--color-or), 0 10px 25px -10px rgba(0,0,0,0.6)",
                      }
                    : undefined
                }
              >
                <img
                  src={`/api/scans/${s.id}/frames/0`}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
                {active ? (
                  <span
                    className="absolute top-1 right-1 chip chip--solid pointer-events-none"
                    style={{ fontSize: "8.5px", padding: "0.15em 0.45em" }}
                  >
                    ★
                  </span>
                ) : null}
                <span className="absolute bottom-1 left-1.5 font-mono text-[8.5px] uppercase tracking-[0.22em] text-[var(--color-or-pale)]/70">
                  {s.kind === "gsplat"
                    ? t("collection.cover.kind.gsplat")
                    : t("collection.cover.kind.scan")}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center gap-3 mt-3">
        <p className="text-[11px] text-[var(--color-ivoire-soft)]">
          {hasSelection
            ? t("collection.cover.hint_active")
            : t("collection.cover.hint_default")}
        </p>
        {hasSelection ? (
          <button
            type="button"
            onClick={() => setCover.mutate({ clear: true })}
            disabled={setCover.isPending}
            className="ml-auto text-[10px] uppercase tracking-[0.22em] text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] transition-colors disabled:opacity-50"
          >
            {t("collection.cover.reset")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
