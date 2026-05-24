import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useYearInReview } from "../hooks/useActivity.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";

const CURRENT_YEAR = new Date().getFullYear();

export default function YearInReviewPage() {
  const params = useParams();
  const year = Number.parseInt(params.year ?? CURRENT_YEAR, 10);
  const t = useT();
  const me = useMe();
  const yir = useYearInReview(year);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (yir.isLoading) return <AppShell><div className="text-center py-16 text-[var(--color-ivoire-soft)]">…</div></AppShell>;

  if (yir.error || !yir.data) {
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">{year}</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("yir.no_data")}</p>
        </main>
      </AppShell>
    );
  }

  const data = yir.data;
  const empty = data.pieces_acquired === 0;

  return (
    <AppShell>
      <main className="max-w-5xl mx-auto px-6 py-12 print:py-4">
        <PosterHeader year={year} t={t} />

        {empty ? (
          <Card className="p-10 text-center">
            <p className="text-[var(--color-ivoire-soft)]">{t("yir.no_data")}</p>
          </Card>
        ) : (
          <>
            <HeroNumber count={data.pieces_acquired} t={t} />
            <div className="gold-rule mx-auto w-56 my-10" />
            <div className="grid md:grid-cols-2 gap-6">
              <Tile title={t("yir.spend.label")}>
                <ul className="space-y-1">
                  {data.spend_by_currency.length === 0 ? (
                    <li className="text-[var(--color-ivoire-soft)]">—</li>
                  ) : (
                    data.spend_by_currency.map((s) => (
                      <li key={s.currency} className="flex justify-between items-baseline">
                        <span className="font-mono text-[var(--color-ivoire-soft)] tracking-wider">{s.currency}</span>
                        <span className="display text-2xl text-[var(--color-or-pale)]">{Number(s.total).toLocaleString()}</span>
                      </li>
                    ))
                  )}
                </ul>
              </Tile>

              <Tile title={t("yir.top_manufacturer.label")}>
                <BigTwoLine
                  value={data.top_manufacturer?.name ?? "—"}
                  hint={data.top_manufacturer ? `× ${data.top_manufacturer.count}` : ""}
                />
              </Tile>

              <Tile title={t("yir.top_series.label")}>
                <BigTwoLine
                  value={data.top_series?.name ?? "—"}
                  hint={data.top_series ? `× ${data.top_series.count}` : ""}
                />
              </Tile>

              <Tile title={t("yir.longest_slip.label")}>
                {data.longest_slip ? (
                  <>
                    <p className="display text-xl text-[var(--color-ivoire)] leading-tight">
                      {data.longest_slip.figure_name}
                    </p>
                    <p className="micro mt-2">
                      {t("yir.longest_slip.detail", {
                        slips: data.longest_slip.slip_count,
                        from: data.longest_slip.original_date ?? "?",
                        to: data.longest_slip.current_date ?? "?",
                      })}
                    </p>
                  </>
                ) : (
                  <p className="text-[var(--color-ivoire-soft)]">—</p>
                )}
              </Tile>
            </div>

            <div className="gold-rule mx-auto w-56 my-12" />

            <section>
              <h3 className="micro mb-4 text-center">{t("yir.timeline.title")}</h3>
              <MonthlyBars data={data.monthly_pieces} t={t} />
            </section>

            <div className="gold-rule mx-auto w-56 my-12" />

            <div className="grid md:grid-cols-2 gap-6">
              {data.first_acquisition ? (
                <Tile title={t("yir.first_acquisition")}>
                  <BigTwoLine
                    value={data.first_acquisition.figure_name}
                    hint={new Date(data.first_acquisition.at).toLocaleDateString()}
                  />
                </Tile>
              ) : null}
              {data.last_acquisition ? (
                <Tile title={t("yir.last_acquisition")}>
                  <BigTwoLine
                    value={data.last_acquisition.figure_name}
                    hint={new Date(data.last_acquisition.at).toLocaleDateString()}
                  />
                </Tile>
              ) : null}
            </div>
          </>
        )}

        <YearNavigation year={year} t={t} />
      </main>
    </AppShell>
  );
}

function PosterHeader({ year, t }) {
  return (
    <header className="text-center mb-10 relative">
      <p className="micro">{t("yir.subtitle")}</p>
      <div className="relative inline-block mt-3">
        <p
          aria-hidden
          className="absolute inset-0 ja text-[10rem] md:text-[14rem] leading-none text-[var(--color-or)]/12 select-none -translate-y-6 md:-translate-y-12"
          style={{ filter: "blur(0.4px)" }}
        >
          年
        </p>
        <h1 className="relative display text-5xl md:text-7xl text-[var(--color-ivoire)]">
          {t("yir.title", { year })}
        </h1>
      </div>
      <div className="gold-rule mx-auto w-32 mt-6" />
    </header>
  );
}

function HeroNumber({ count, t }) {
  return (
    <div className="text-center">
      <p className="micro">{t("yir.pieces.label")}</p>
      <p className="display text-9xl md:text-[10rem] text-[var(--color-or)] leading-none mt-2">
        {count}
      </p>
    </div>
  );
}

function Tile({ title, children }) {
  return (
    <Card className="p-6">
      <p className="micro mb-3">{title}</p>
      {children}
    </Card>
  );
}

function BigTwoLine({ value, hint }) {
  return (
    <>
      <p className="display text-2xl text-[var(--color-ivoire)] leading-tight">{value}</p>
      {hint ? <p className="micro mt-1">{hint}</p> : null}
    </>
  );
}

function MonthlyBars({ data, t }) {
  // Normalize 12-month array
  const counts = new Array(12).fill(0);
  data.forEach((m) => {
    if (m.month >= 1 && m.month <= 12) counts[m.month - 1] = m.count;
  });
  const max = Math.max(1, ...counts);

  return (
    <div className="grid grid-cols-12 gap-2 h-40 items-end">
      {counts.map((c, i) => (
        <div key={i} className="flex flex-col items-center justify-end h-full">
          <div className="relative w-full" style={{ height: `${(c / max) * 100}%` }}>
            <div className="absolute inset-x-0 bottom-0 top-0 bg-[var(--color-or)]/70 hover:bg-[var(--color-or)] transition-colors" />
            {c > 0 ? (
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] text-[var(--color-or-pale)]">
                {c}
              </span>
            ) : null}
          </div>
          <span className="micro mt-2 opacity-70">{t(`yir.month.${i + 1}`)}</span>
        </div>
      ))}
    </div>
  );
}

function YearNavigation({ year, t }) {
  return (
    <nav className="mt-12 flex items-center justify-between text-[11px] uppercase tracking-[0.2em] print:hidden">
      <Link
        to={`/year-in-review/${year - 1}`}
        className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)]"
      >
        ← {t("yir.prev")} ({year - 1})
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="text-[var(--color-or-pale)] hover:text-[var(--color-or)]"
      >
        ⎙ {t("yir.print")}
      </button>
      {year < CURRENT_YEAR ? (
        <Link
          to={`/year-in-review/${year + 1}`}
          className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)]"
        >
          {t("yir.next")} ({year + 1}) →
        </Link>
      ) : (
        <span aria-hidden />
      )}
    </nav>
  );
}
