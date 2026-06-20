import Tabs from "../../components/ui/Tabs.jsx";

/**
 * The settings section index, in two responsive forms that share one `active`
 * id + one `onSelect(id)` callback (the orchestrator scrolls the panel into
 * view and the scroll-spy keeps `active` in sync):
 *
 *   - lg+  : a sticky vertical rail with a hanko-red active marker (left
 *            border + diamond), echoing AdminLayout's rail + AppShell NavItem.
 *   - <lg  : a sticky horizontal {@link Tabs} bar — the mobile equivalent of
 *            the desktop scroll-spy index (previously missing). It pins under
 *            the app header so the current section is always reachable while
 *            the panels scroll.
 *
 * `sections`: [{ id, kanji, label }].
 */
export default function SettingsNav({ sections, active, onSelect, heading }) {
  return (
    <nav aria-label={heading}>
      {/* Mobile / tablet: sticky underlined Tabs (kanji + label). Pinned just
          below the compact app header (~3rem when scrolled) so the current
          section stays reachable while the panels scroll. */}
      <div className="lg:hidden sticky top-12 z-[var(--z-sticky)] -mx-[var(--space-page-x)] px-[var(--space-page-x)] bg-[var(--surface)] border-b border-[var(--border-subtle)]">
        <Tabs
          className="border-b-0"
          value={active}
          onChange={onSelect}
          tabs={sections.map((s) => ({
            value: s.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="ja text-[var(--accent)] leading-none">
                  {s.kanji}
                </span>
                {s.label}
              </span>
            ),
          }))}
        />
      </div>

      {/* Desktop: sticky vertical rail. */}
      <div className="hidden lg:block lg:sticky lg:top-24">
        <p className="micro pb-3 mb-2 border-b border-[var(--border-subtle)]">{heading}</p>
        <ul className="flex flex-col">
          {sections.map((s, i) => {
            const isActive = active === s.id;
            return (
              <li key={s.id} className="reveal" style={{ "--i": i }}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onSelect(s.id);
                  }}
                  aria-current={isActive ? "true" : undefined}
                  className={`tap-target group flex items-center gap-2.5 whitespace-nowrap py-2.5 border-l-2 transition-colors outline-none focus-visible:text-[var(--accent)] ${
                    isActive
                      ? "text-[var(--on-surface)]"
                      : "text-[var(--on-surface-muted)] hover:text-[var(--on-surface)]"
                  }`}
                  style={{
                    borderLeftColor: isActive ? "var(--primary)" : "transparent",
                    paddingInlineStart: "0.75rem",
                  }}
                >
                  <span
                    aria-hidden
                    className="ja text-base leading-none transition-colors"
                    style={{
                      color: isActive ? "var(--primary)" : "var(--accent)",
                      opacity: isActive ? 1 : 0.55,
                    }}
                  >
                    {s.kanji}
                  </span>
                  <span className="text-sm">{s.label}</span>
                  {isActive ? (
                    <span
                      aria-hidden
                      className="ml-auto w-1 h-1 bg-[var(--primary)] rotate-45 shrink-0"
                    />
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
