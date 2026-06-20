import { Search, Plus, X } from "lucide-react";
import Card from "../../components/Card.jsx";
import { Button } from "../../components/ui/index.js";
import Reveal from "../../components/motion/Reveal.jsx";

/**
 * The « Où est… ? » lookup + create-vitrine control. Pure presentation: the
 * orchestrator owns the query / create state and the matched-results array;
 * this just renders the chrome (restyled to semantic tokens, 探 marker kept).
 * The create-vitrine affordance is a SECONDARY control here — the page's single
 * primary CTA lives in the PageLayout toolbar.
 */
export default function VitrineLookup({
  t,
  query,
  onQuery,
  matched,
  creating,
  newName,
  onNewName,
  onStartCreate,
  onSubmitCreate,
  onCancelCreate,
  createPending,
}) {
  return (
    <Reveal as="div" delay={0.05}>
      <Card className="relative overflow-hidden p-4 md:p-5">
        <span aria-hidden className="kanji-mark text-[8rem] -top-6 -right-2 select-none">
          探
        </span>
        <div className="relative flex flex-wrap items-center gap-3">
          <label
            className="flex items-center gap-3 flex-1 min-w-[16rem] border border-[var(--border)] focus-within:border-[var(--accent)] bg-[var(--surface-sunken)] px-4 py-2.5 transition-colors"
            style={{ borderRadius: "var(--radius-sm)" }}
          >
            <Search size={16} className="text-[var(--accent)] shrink-0" aria-hidden />
            <input
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={t("vitrines.search_ph")}
              aria-label={t("vitrines.search_ph")}
              className="flex-1 bg-transparent outline-none text-[var(--on-surface)] display text-xl placeholder:text-[var(--on-surface-subtle)]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => onQuery("")}
                aria-label={t("vitrines.search_clear", { default: "Effacer" })}
                className="tap-target w-11 h-11 grid place-items-center shrink-0 -mr-2 text-[var(--on-surface-muted)] hover:text-[var(--danger)] transition-colors"
              >
                <X size={16} />
              </button>
            ) : null}
          </label>
          {creating ? (
            <span
              className="inline-flex items-center border border-[var(--accent)] bg-[var(--surface-sunken)]"
              style={{ borderRadius: "var(--radius-sm)" }}
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => onNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmitCreate();
                  if (e.key === "Escape") onCancelCreate();
                }}
                placeholder={t("vitrines.new_cabinet_ph")}
                aria-label={t("vitrines.new_cabinet_ph")}
                className="bg-transparent outline-none text-[var(--on-surface)] px-3 py-2.5 w-44"
              />
              <button
                type="button"
                onClick={onSubmitCreate}
                disabled={createPending}
                className="tap-target px-3 self-stretch bg-[var(--primary)] text-[var(--color-ivoire)] text-[11px] uppercase tracking-[0.16em] hover:bg-[var(--primary-hover)] transition-colors disabled:opacity-60"
              >
                {t("vitrines.create")}
              </button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onStartCreate}
              iconStart={<Plus size={15} />}
              className="uppercase whitespace-nowrap"
            >
              {t("vitrines.new_cabinet")}
            </Button>
          )}
        </div>

        {matched ? (
          <p className="relative mt-3 pt-3 border-t border-[var(--border-subtle)] text-[13px] text-[var(--on-surface-muted)]">
            {matched.length === 0 ? (
              <span className="italic">{t("vitrines.search_none", { q: query.trim() })}</span>
            ) : (
              <>
                <span className="micro-tight mr-1.5 text-[var(--accent)]">
                  {t("vitrines.search_found", { n: matched.length })}
                </span>
                {matched.slice(0, 4).map((o, i) => (
                  <span key={o.id} className="whitespace-nowrap">
                    {i > 0 ? (
                      <span aria-hidden className="text-[var(--on-surface-subtle)]">
                        {" "}
                        ·{" "}
                      </span>
                    ) : (
                      ""
                    )}
                    <b className="text-[var(--color-jade)] font-medium">{o.figure_name}</b>
                    <span className="text-[var(--accent)]">
                      {" "}
                      「{(o.location || "").trim() || t("vitrines.loose")}」
                    </span>
                  </span>
                ))}
                {matched.length > 4 ? (
                  <span aria-hidden className="text-[var(--on-surface-muted)]">
                    {" "}
                    …
                  </span>
                ) : (
                  ""
                )}
              </>
            )}
          </p>
        ) : null}
      </Card>
    </Reveal>
  );
}
