/**
 * Tiny acquisition-intensity sparkline (page-local). Pure SVG, no animation —
 * the area/line reveal is CSS-driven on the parent `.ledger-row:hover`. Used
 * inside the spend ledger rows. Reuses the `.sparkline*` classes in index.css.
 */
export default function Sparkline({ data }) {
  const w = 110;
  const h = 28;
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));
  const stepX = data.length > 1 ? w / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = h - ((Number(d.count) || 0) / (max || 1)) * h;
    return [x, y];
  });
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const last = points[points.length - 1];
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path className="sparkline-area" d={area} />
      <path className="sparkline-line" d={path} />
      {points.map((p, i) => (
        <circle key={i} className="spark-pt" cx={p[0]} cy={p[1]} r="1.7" />
      ))}
      {last ? <circle className="spark-end" cx={last[0]} cy={last[1]} r="2" /> : null}
    </svg>
  );
}
