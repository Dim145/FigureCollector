import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { appLocale } from "../lib/locale.js";
import { useAdminOverview } from "../hooks/useAdmin.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";

/**
 * /admin — instance overview, redrawn to Direction A ("Shōjo-Noir").
 *
 * Renders inside AdminLayout's <Outlet/>, so the global "Administration" h1 +
 * sub-nav already sit above this page. This view is therefore an editorial
 * *section* of the admin surface rather than a second page header:
 *
 *   - an editorial section header (kicker · 蒐集 · label → AccentTitle h2 →
 *     gold-rule → italic gloss) over a faint kanji-mark watermark;
 *   - the seven instance counters as a Direction-A StatCard strip (CountUp,
 *     gold for the headline catalogue figure, hanko-red for pre-orders);
 *   - two Card panels — Gérer (quick-action links to the other admin tabs,
 *     hanko-red primary CTA) and État (read-only health read-outs derived
 *     from the same counters, gold for notable figures).
 *
 * Data + behaviour are unchanged from the prior layout: the single
 * `useAdminOverview` query and its `o.*` counters drive everything. GPU-light
 * throughout — flat fills, hairlines, the shared `.reveal` stagger, no meshes
 * / blur / continuous animation.
 */
export default function AdminOverviewPage() {
  const t = useT();
  const overview = useAdminOverview();

  if (overview.isLoading) {
    return (
      <p
        role="status"
        aria-live="polite"
        className="text-center text-[var(--color-ivoire-soft)] py-12"
      >
        …
      </p>
    );
  }
  if (overview.error || !overview.data) {
    return (
      <p
        role="alert"
        className="text-center text-[var(--color-laque-bright)] py-12"
      >
        {overview.error?.message ?? t("error.unknown")}
      </p>
    );
  }

  const o = overview.data;

  // Instance counters → Direction-A stat strip. Counts only (no money), so
  // tones stay quiet; gold marks the headline catalogue figure and hanko-red
  // flags the time-sensitive pre-order count, per the playbook.
  const cards = [
    {
      label: t("admin.kpi.users"),
      value: o.user_count,
      sub: t("admin.kpi.admins", { n: o.admin_count }),
    },
    { label: t("admin.kpi.figures"), value: o.figure_count, tone: "gold" },
    { label: t("admin.kpi.owned"), value: o.owned_item_count },
    { label: t("admin.kpi.preorders"), value: o.preorder_count, tone: "red" },
    { label: t("admin.kpi.photos"), value: o.photo_count },
    { label: t("admin.kpi.scans"), value: o.scan_count },
  ];

  // Quick-action links — straight to the existing admin tabs. The first is the
  // hanko-red primary CTA; the rest are gold-outline ghosts.
  const actions = [
    { to: "/admin/users", label: t("admin.tab.users"), primary: true },
    { to: "/admin/figures", label: t("admin.tab.figures") },
    { to: "/admin/catalog", label: t("admin.tab.catalog") },
    { to: "/admin/workers", label: t("admin.tab.workers") },
    { to: "/admin/tasks", label: t("admin.tab.tasks") },
  ];

  // État read-outs — derived purely from the counters above (no extra fetch).
  // Médias = the photos + scan jobs that the workers/tasks tabs manage.
  const media = o.photo_count + o.scan_count;
  const health = [
    {
      label: t("admin.overview.health.admins", { default: "Administrateurs" }),
      value: o.admin_count,
      tone: "red",
    },
    {
      label: t("admin.overview.health.media", { default: "Médias (photos + scans)" }),
      value: media,
      tone: "gold",
    },
    {
      label: t("admin.overview.health.preorders", { default: "Pré-commandes en cours" }),
      value: o.preorder_count,
    },
  ];

  return (
    <div className="relative">
      {/* ─── Editorial section header ─── */}
      <header className="relative mb-10">
        <span
          aria-hidden
          className="kanji-mark text-[18rem] -top-24 -right-6 hidden md:block select-none"
        >
          蒐
        </span>

        <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
          <span
            aria-hidden
            className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45"
          />
          {t("admin.subtitle")}
          <span aria-hidden className="ja not-italic text-[var(--color-or)]">
            蒐集
          </span>
          {t("admin.overview.kicker_label", { default: "ÉTAT DE L'INSTANCE" })}
        </p>
        <h2
          className="display text-4xl md:text-5xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
          style={{ "--i": 1 }}
        >
          <AccentTitle text={t("admin.tab.overview")} />
        </h2>
        <div className="gold-rule w-24 mt-5 reveal" style={{ "--i": 2 }} />
        <p
          className="display-italic text-[var(--color-or)] text-base md:text-lg mt-4 max-w-xl reveal"
          style={{ "--i": 3 }}
        >
          {t("admin.overview.subtitle")}
        </p>
      </header>

      {/* ─── Instance metrics strip ─── */}
      <section className="reveal" style={{ "--i": 4 }} aria-label={t("admin.overview.metrics", { default: "Compteurs de l'instance" })}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {cards.map((c) => (
            <StatCard
              key={c.label}
              label={c.label}
              value={c.value}
              sub={c.sub}
              tone={c.tone}
            />
          ))}
        </div>
      </section>

      {/* ─── Quick actions + instance health ─── */}
      <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <Panel
          kanji="管"
          eyebrow={t("admin.overview.manage.eyebrow", { default: "GESTION" })}
          title={t("admin.overview.manage.title", { default: "Gérer la plateforme" })}
        >
          <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
            {t("admin.overview.manage.body", {
              default:
                "Accédez directement aux surfaces d’administration : comptes, catalogue, entités et file de calcul.",
            })}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            {actions.map((a) => (
              <Link key={a.to} to={a.to} className="tap-target">
                <Button variant={a.primary ? "primary" : "ghost"}>
                  {a.label}
                </Button>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          kanji="鑑"
          eyebrow={t("admin.overview.health.eyebrow", { default: "ÉTAT" })}
          title={t("admin.overview.health.title", { default: "Santé de l’instance" })}
        >
          <dl className="space-y-px">
            {health.map((h, i) => (
              <div
                key={h.label}
                className="flex items-baseline justify-between gap-4 py-3"
                style={{
                  borderTop:
                    i === 0
                      ? "none"
                      : "1px solid color-mix(in oklab, var(--color-or) 12%, transparent)",
                }}
              >
                <dt className="label-mono text-[var(--color-ivoire-soft)]/70">
                  {h.label}
                </dt>
                <dd
                  className="figural text-2xl leading-none"
                  style={{
                    color:
                      h.tone === "gold"
                        ? "var(--color-or)"
                        : h.tone === "red"
                          ? "var(--color-laque-bright)"
                          : "var(--color-ivoire)",
                  }}
                >
                  {Number(h.value).toLocaleString(appLocale())}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[11px] uppercase tracking-[0.18em] text-[var(--color-ivoire-soft)]/55 flex items-center gap-2">
            <span
              aria-hidden
              className="w-1.5 h-1.5 rounded-full bg-[var(--color-or)]"
            />
            {t("admin.overview.health.nominal", { default: "Système nominal" })}
          </p>
        </Panel>
      </div>

    </div>
  );
}

// =============================================================================
// Panel — a Direction-A Card with an editorial kicker + kanji header. Mirrors
// the Settings page panel so the admin surface reads in the same language.
// =============================================================================

function Panel({ kanji, eyebrow, title, children }) {
  return (
    <Card as="section" className="relative overflow-hidden p-6 md:p-8 reveal">
      {/* Calm kanji watermark — gold, very faint, bleeding off the corner.
          Static, pointer-inert: GPU-free atmosphere. */}
      <span
        aria-hidden
        className="kanji-mark text-[9rem] -top-8 -right-3 select-none"
      >
        {kanji}
      </span>
      <div className="relative">
        <header className="mb-6">
          <p className="micro flex items-center gap-2">
            <span
              aria-hidden
              className="ja not-italic text-base text-[var(--color-or)] leading-none"
            >
              {kanji}
            </span>
            {eyebrow}
          </p>
          <h3 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)] leading-tight">
            {title}
          </h3>
          <div className="gold-rule w-16 mt-4" />
        </header>
        {children}
      </div>
    </Card>
  );
}
