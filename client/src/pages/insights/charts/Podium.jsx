import Card from "../../../components/Card.jsx";
import { colorMix } from "../chapterTheme.js";

function truncate(s, max) {
  if (!s || s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/**
 * Palmarès column (page-local) — top-3 podium tiers (#1 lifted) + a ranked
 * list for ranks 4–10. Reuses the `.podium-*` classes in index.css. Pure
 * layout, no charting library.
 */
export default function Podium({ title, rows, t }) {
  if (!rows || rows.length === 0) {
    return (
      <Card className="p-7">
        <p className="micro mb-4">{title}</p>
        <p className="text-[var(--color-ivoire-soft)] italic">{t("stats.top.empty")}</p>
      </Card>
    );
  }
  const podium = rows.slice(0, 3);
  const rest = rows.slice(3, 10);
  return (
    <div>
      <p className="micro mb-4 inline-flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block w-5 h-px"
          style={{ background: colorMix("var(--color-or)", 80) }}
        />
        {title}
      </p>
      <div className="grid grid-cols-3 gap-1.5 items-end">
        {podium.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            className={`podium-tier ledger-tip ${i === 0 ? "podium-tier--gold" : ""}`}
            style={{ "--lift": i === 0 ? "-8px" : "0px" }}
            data-tip={t("stats.top.tip", {
              default: "{name} · {count} fig.",
              name: r.name,
              count: r.count,
            })}
          >
            <span className="podium-rank">{String(i + 1).padStart(2, "0")}</span>
            <span className="podium-name">{truncate(r.name, 36)}</span>
            <span className="podium-count">
              {t("stats.top.count", { default: "{count} fig.", count: r.count })}
            </span>
          </div>
        ))}
      </div>

      {rest.length > 0 ? (
        <ol className="mt-5 space-y-1.5">
          {rest.map((r, idx) => (
            <li
              key={`${r.name}-${idx}`}
              className="podium-rest flex items-baseline gap-3 text-[13px]"
            >
              <span className="podium-rest-rank font-mono text-[10px] w-5 shrink-0">
                {String(idx + 4).padStart(2, "0")}
              </span>
              <span className="podium-rest-name flex-1 truncate">{r.name}</span>
              <span className="font-mono text-[10.5px] text-[var(--color-or-pale)] shrink-0">
                {r.count}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
