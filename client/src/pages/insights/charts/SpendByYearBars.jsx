import { appLocale } from "../../../lib/locale.js";
import { fmtAmount } from "../chapterTheme.js";

/**
 * Spend-by-year bars (page-local) for the dominant currency (largest cumulative
 * total). Reuses the `.ins-bars`/`.ins-bar*` classes in index.css. Pure layout;
 * wrapped in an `overflow-x:auto` well by the caller for mobile.
 */
export default function SpendByYearBars({ spend }) {
  const locale = appLocale();
  const byCur = {};
  for (const r of spend) byCur[r.currency] = (byCur[r.currency] || 0) + Number(r.total);
  const currency = Object.keys(byCur).sort((a, b) => byCur[b] - byCur[a])[0];
  const rows = spend.filter((r) => r.currency === currency).sort((a, b) => a.year - b.year);
  const max = Math.max(...rows.map((r) => Number(r.total)), 1);
  const curYear = new Date().getFullYear();
  return (
    <div className="ins-bars">
      {rows.map((r) => (
        <div className={`ins-bar${r.year === curYear ? " cur" : ""}`} key={r.year}>
          <span className="ins-bar-v">{fmtAmount(r.total, r.currency, locale)}</span>
          <span
            className="ins-barfill"
            style={{ height: `${Math.max(3, (Number(r.total) / max) * 100)}%` }}
          />
          <span className="ins-bar-y">{r.year}</span>
        </div>
      ))}
    </div>
  );
}
