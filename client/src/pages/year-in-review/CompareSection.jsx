import Money from "../../components/Money.jsx";
import {
  EditorialChapter,
  mix,
  fmtNumber,
  ACCENT_GOLD,
  ACCENT_JADE,
  ACCENT_RED,
} from "./shared.jsx";

/**
 * L'année en regard — this year vs the previous one. Self-hides when the prior
 * year had no activity (nothing to compare against). Gold value figures, jade
 * for an increase, hanko-red for a decline — the A gain/loss code.
 */
export default function CompareSection({ data, t }) {
  const cmp = data.comparison;
  if (!cmp) return null;
  const prevHadData = cmp.pieces_acquired > 0 || (cmp.spend_by_currency?.length ?? 0) > 0;
  if (!prevHadData) return null;

  // Spend on the dominant current-year currency, matched in the prior year.
  const nowSpend = data.spend_by_currency?.[0] ?? null;
  const prevSpend = nowSpend
    ? (cmp.spend_by_currency ?? []).find((s) => s.currency === nowSpend.currency)
    : (cmp.spend_by_currency?.[0] ?? null);
  const spendCur = nowSpend?.currency ?? prevSpend?.currency;

  const rows = [
    {
      label: t("yrcmp.pieces"),
      now: data.pieces_acquired,
      prev: cmp.pieces_acquired,
      fmt: (v) => fmtNumber(v),
    },
    spendCur
      ? {
          label: t("yrcmp.spend"),
          now: Number(nowSpend?.total ?? 0),
          prev: Number(prevSpend?.total ?? 0),
          fmt: (v) => <Money amount={v} currency={spendCur} round />,
        }
      : null,
    {
      label: t("yrcmp.velocity"),
      now: data.pieces_acquired / 12,
      prev: cmp.pieces_acquired / 12,
      fmt: (v) => t("yrcmp.per_month", { n: fmtNumber(v, 1) }),
    },
  ].filter(Boolean);

  return (
    <EditorialChapter kicker={t("yrcmp.title")} kanji="較" accent={ACCENT_JADE}>
      <p className="mb-4">
        <span className="display italic text-2xl text-[var(--on-surface)]">{data.year}</span>{" "}
        <span className="micro-tight">{t("yrcmp.vs", { year: cmp.year })}</span>
      </p>
      <dl className="space-y-3">
        {rows.map((r) => (
          <CmpRow
            key={r.label}
            label={r.label}
            now={r.now}
            prev={r.prev}
            prevYear={cmp.year}
            fmt={r.fmt}
          />
        ))}
      </dl>
    </EditorialChapter>
  );
}

function CmpRow({ label, now, prev, prevYear, fmt }) {
  const delta = prev !== 0 ? Math.round(((now - prev) / prev) * 100) : null;
  const up = now >= prev;
  const deltaColor = up ? ACCENT_JADE : ACCENT_RED;
  return (
    <div
      className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 py-2 border-b border-dashed last:border-b-0"
      style={{ borderColor: mix(ACCENT_GOLD, 15) }}
    >
      <dt className="micro-tight normal-case tracking-[0.18em] text-[var(--on-surface-muted)]">
        {label}
      </dt>
      <dd className="text-right">
        <span className="display text-xl text-[var(--on-surface)] block leading-none">
          {fmt(now)}
        </span>
        <span className="micro-tight block mt-1 text-[var(--on-surface-subtle)]">
          {prevYear} · {fmt(prev)}
        </span>
      </dd>
      <dd
        className="font-mono text-[11px] tracking-wider text-right tabular-nums"
        style={{ color: deltaColor }}
      >
        {delta != null ? `${up ? "↑" : "↓"} ${Math.abs(delta)}%` : now > 0 ? "↑" : "—"}
      </dd>
    </div>
  );
}
