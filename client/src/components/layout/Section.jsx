/**
 * A titled content block within a page. Standardises the repeated
 * `kicker + h2 + gold-rule` pattern down long pages (Settings, Stats, Figure
 * detail) into one component with a consistent rhythm + actions slot.
 */
export default function Section({
  title,
  kicker,
  actions,
  divider = false,
  children,
  className = "",
  id,
}) {
  return (
    <section id={id} className={className} style={{ marginBottom: "var(--space-section)" }}>
      {title || kicker || actions ? (
        <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
          <div className="min-w-0">
            {kicker ? <p className="micro mb-2">{kicker}</p> : null}
            {title ? <h2 className="display text-2xl text-[var(--on-surface)]">{title}</h2> : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {divider ? <div className="gold-rule mb-5" /> : null}
      {children}
    </section>
  );
}
