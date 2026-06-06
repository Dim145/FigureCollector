import { useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { api } from "../lib/api.js";
import { useOwnedItems, useCreateFigure } from "../hooks/useCollection.js";
import {
  useWishlistItems,
  useAddWishlistItem,
  useResolveImport,
  useFigureMatch,
} from "../hooks/useWishlist.js";
import { ORZGK_URL_RE, autoPickFromDetail } from "../lib/orzgkMap.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";

/**
 * « Importer dans mes souhaits » — bulk import from a public orzgk wishlist.
 *
 *   ① Coller   — paste the list's public share URL (server fetches + paginates)
 *                or product links; HTML paste is the private-list fallback.
 *   ② Choisir  — each parsed item is matched against the catalogue (trigram %);
 *                ≥90% auto-links, owned/already-wished are locked out, the rest
 *                default to "create new". Bulk-select up to 10.
 *   ③ Importer — matched → just wishlisted; new → orzgk detail → catalogue
 *                figure (same buildPick mapping as the add page, version
 *                pre-selected) → wishlisted. Progress + summary.
 *
 * Direction A ("Shōjo-Noir"): editorial header (蒐/輸 kicker + AccentTitle +
 * gold-rule), the staged flow in noir Card panels, the preview as a FigureCard
 * grid with a per-item include/exclude seal. Gold for value, hanko-red for
 * actions. GPU-light: flat fills + hairlines + the shared Reveal stagger.
 */

const BATCH_MAX = 10;
const AUTO_THRESHOLD = 0.9; // ≥ → auto-associate
const SUGGEST_THRESHOLD = 0.5; // ≥ → "à vérifier" (offer the match), else "new"

export default function WishlistImportPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const wishlist = useWishlistItems();
  const resolve = useResolveImport();
  const match = useFigureMatch();
  const createFigure = useCreateFigure();
  const addWish = useAddWishlistItem();

  const [raw, setRaw] = useState("");
  const [phase, setPhase] = useState("input"); // input | review | importing | done
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [summary, setSummary] = useState(null);

  const ownedIds = useMemo(
    () => new Set((owned.data ?? []).map((o) => o.figure_id)),
    [owned.data],
  );
  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );

  const selectedCount = candidates.filter((c) => c.selected).length;
  const busy = resolve.isPending || match.isPending;
  // Don't categorise until the owned + wishlist sets are loaded, otherwise an
  // owned figure can be mis-tagged as a fresh "match" and hit the 409 gate.
  const ready = !owned.isLoading && !wishlist.isLoading;

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  // ── ① analyse ────────────────────────────────────────────────────────────
  const analyse = async () => {
    setError(null);
    const text = raw.trim();
    if (!text) return;

    let items = [];
    try {
      if (looksLikeHtml(text)) {
        items = await resolve.mutateAsync({ html: text });
      } else {
        const tokens = text.split(/\s+/).filter(Boolean);
        const wishUrl = tokens.find((u) => /orzgk\.com\/.*(wishlist|wlfmc)/i.test(u));
        if (wishUrl) {
          items = await resolve.mutateAsync({ url: wishUrl });
        } else {
          const productUrls = tokens.filter((u) => ORZGK_URL_RE.test(u));
          if (productUrls.length === 0) {
            setError(t("import.err.no_source"));
            return;
          }
          items = productUrls.map((u) => ({
            title: urlToTitle(u),
            studio: null,
            version: null,
            price: null,
            image_url: null,
            detail_url: u.split(/[?#]/)[0],
          }));
        }
      }
    } catch (e) {
      setError(e?.message ?? t("import.err.fetch"));
      return;
    }

    // Dedupe by canonical product URL.
    const seen = new Set();
    items = items.filter(
      (it) => it.detail_url && !seen.has(it.detail_url) && seen.add(it.detail_url),
    );
    if (items.length === 0) {
      setError(t("import.err.empty"));
      return;
    }

    // Match each title against the catalogue.
    let lists = [];
    try {
      lists = await match.mutateAsync(
        items.map((it) => ({ name: it.title, manufacturer: it.studio ?? undefined })),
      );
    } catch {
      lists = items.map(() => []);
    }

    let picked = 0;
    const cands = items.map((it, i) => {
      const matches = lists[i] ?? [];
      const best = matches[0];
      let status, action, chosenFigureId = null, selected = false;
      if (best && best.score >= AUTO_THRESHOLD && ownedIds.has(best.figure_id)) {
        status = "owned";
        action = "skip";
      } else if (best && best.score >= AUTO_THRESHOLD && wishedIds.has(best.figure_id)) {
        status = "wished";
        action = "skip";
      } else if (best && best.score >= AUTO_THRESHOLD) {
        status = "match";
        action = "link";
        chosenFigureId = best.figure_id;
        selected = picked < BATCH_MAX && (picked++, true);
      } else if (best && best.score >= SUGGEST_THRESHOLD) {
        status = "low";
        action = "new";
        selected = picked < BATCH_MAX && (picked++, true);
      } else {
        status = "new";
        action = "new";
        selected = picked < BATCH_MAX && (picked++, true);
      }
      return { ...it, matches, best, status, action, chosenFigureId, selected };
    });
    setCandidates(cands);
    setPhase("review");
  };

  // ── ② selection / association ──────────────────────────────────────────────
  const toggle = (idx) =>
    setCandidates((cs) =>
      cs.map((c, i) => {
        if (i !== idx || c.action === "skip") return c;
        if (!c.selected && selectedCount >= BATCH_MAX) return c; // cap
        return { ...c, selected: !c.selected };
      }),
    );

  const selectAll = (on) =>
    setCandidates((cs) => {
      let n = 0;
      return cs.map((c) => {
        if (c.action === "skip") return { ...c, selected: false };
        if (on && n < BATCH_MAX) {
          n++;
          return { ...c, selected: true };
        }
        return { ...c, selected: on ? false : false };
      });
    });

  const setAssoc = (idx, value) =>
    setCandidates((cs) =>
      cs.map((c, i) => {
        if (i !== idx) return c;
        if (value === "__new__") return { ...c, action: "new", chosenFigureId: null };
        return { ...c, action: "link", chosenFigureId: value };
      }),
    );

  // ── ③ commit ───────────────────────────────────────────────────────────────
  const commit = async () => {
    const chosen = candidates
      .filter((c) => c.selected && c.action !== "skip")
      .slice(0, BATCH_MAX);
    if (chosen.length === 0) return;

    setPhase("importing");
    setProgress({ done: 0, total: chosen.length, label: "" });
    let created = 0, linked = 0, errors = 0;

    for (const c of chosen) {
      setProgress((p) => ({ ...p, label: c.title }));
      try {
        if (c.action === "link" && c.chosenFigureId) {
          await addWish.mutateAsync({ figure_id: c.chosenFigureId });
          linked++;
        } else {
          const detail = await api.get(
            `/external/orzgk/detail?url=${encodeURIComponent(c.detail_url)}`,
          );
          const payload = autoPickFromDetail(detail, c.version);
          const fig = await createFigure.mutateAsync(payload);
          await addWish.mutateAsync({ figure_id: fig.id });
          created++;
        }
      } catch {
        errors++;
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setSummary({ created, linked, errors });
    setPhase("done");
  };

  const reset = () => {
    setCandidates([]);
    setSummary(null);
    setRaw("");
    setError(null);
    setPhase("input");
  };

  return (
    <AppShell>
      <main className="relative max-w-5xl mx-auto px-6 py-16">
        {/* Editorial header — kicker · 蒐 · SOUHAITS → AccentTitle h1 → gold-rule,
            over a faint 蒐 watermark bleeding off the top-right corner. */}
        <Reveal as="header" className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[22rem] -top-28 -right-8 hidden md:block select-none"
          >
            蒐
          </span>

          <p className="micro flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("import.eyebrow")}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">輸</span>
            {t("import.kicker_label", { default: "SOUHAITS" })}
          </p>
          <h1 className="display text-5xl md:text-6xl text-[var(--color-ivoire)] mt-3 leading-[0.95]">
            <AccentTitle text={t("import.title")} />
          </h1>
          <div className="gold-rule w-24 mt-6" />
          <p className="mt-5 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("import.subtitle")}
          </p>
        </Reveal>

        <Steps phase={phase} t={t} />

        {phase === "input" ? (
          <InputPhase
            raw={raw}
            setRaw={setRaw}
            onAnalyse={analyse}
            busy={busy || !ready}
            error={error}
            t={t}
          />
        ) : null}

        {phase === "review" ? (
          <ReviewPhase
            candidates={candidates}
            selectedCount={selectedCount}
            onToggle={toggle}
            onSelectAll={selectAll}
            onAssoc={setAssoc}
            onCommit={commit}
            onBack={() => setPhase("input")}
            t={t}
          />
        ) : null}

        {phase === "importing" ? <ImportingPhase progress={progress} t={t} /> : null}

        {phase === "done" ? (
          <DonePhase summary={summary} onReset={reset} t={t} />
        ) : null}
      </main>
    </AppShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Phases
// ═══════════════════════════════════════════════════════════════════════════

/** Three-beat editorial stepper: ① Coller → ② Choisir → ③ Importer. The
 *  active beat carries the hanko-red marker, completed beats a gold ✓. */
function Steps({ phase, t }) {
  const order = ["input", "review", "done"];
  const cur = phase === "importing" ? 2 : order.indexOf(phase);
  const labels = [t("import.step.paste"), t("import.step.choose"), t("import.step.import")];
  return (
    <ol
      className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-10"
      aria-label={t("import.steps_label", { default: "Étapes de l'import" })}
    >
      {labels.map((label, i) => {
        const done = i < cur;
        const on = i === cur;
        return (
          <li key={i} className="flex items-center gap-3">
            <span
              aria-current={on ? "step" : undefined}
              className="inline-flex items-center gap-2.5 text-[11px] uppercase tracking-[0.2em]"
              style={{
                color: on
                  ? "var(--color-ivoire)"
                  : done
                    ? "var(--color-or-pale)"
                    : "color-mix(in oklab, var(--color-ivoire-soft) 70%, transparent)",
              }}
            >
              <span
                aria-hidden
                className="figural grid place-items-center w-7 h-7 text-sm leading-none border"
                style={{
                  borderColor: on
                    ? "var(--color-laque-bright)"
                    : done
                      ? "color-mix(in oklab, var(--color-or) 55%, transparent)"
                      : "color-mix(in oklab, var(--color-or) 22%, transparent)",
                  background: on
                    ? "color-mix(in oklab, var(--color-laque) 14%, transparent)"
                    : "transparent",
                  color: on
                    ? "var(--color-laque-bright)"
                    : done
                      ? "var(--color-or)"
                      : "var(--color-ivoire-soft)",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              {label}
            </span>
            {i < labels.length - 1 ? (
              <span
                aria-hidden
                className="ja text-[var(--color-or)]/40 leading-none"
              >
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** ① Source — paste the public list URL (or product links / HTML). A refined
 *  Direction-A textarea well + hint + a red-pill primary CTA. */
function InputPhase({ raw, setRaw, onAnalyse, busy, error, t }) {
  return (
    <Reveal as="div">
      <Card className="relative overflow-hidden p-6 md:p-8">
        <span
          aria-hidden
          className="kanji-mark text-[10rem] -top-8 -right-2 select-none"
        >
          蒐
        </span>

        <div className="relative">
          <p className="micro flex items-center gap-2">
            <span className="ja not-italic text-base text-[var(--color-or)] leading-none" aria-hidden>
              蒐
            </span>
            {t("import.phase.source")}
          </p>
          <div className="gold-rule w-16 mt-4 mb-6" />

          <label className="block">
            <span className="micro block mb-2">
              {t("import.source_label", { default: "Lien ou HTML" })}
            </span>
            <textarea
              className="w-full min-h-[8.5rem] resize-y bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-4 py-3 text-sm leading-relaxed text-[var(--color-ivoire)] outline-none transition-colors duration-200 focus:border-[var(--color-or)]"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.01em" }}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t("import.paste_ph")}
              spellCheck={false}
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="mt-3 text-sm text-[var(--color-laque-bright)] tracking-wide border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <p className="max-w-md text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
              {t("import.paste_hint")}
            </p>
            <Button
              variant="primary"
              onClick={onAnalyse}
              loading={busy}
              disabled={busy || !raw.trim()}
              className="shrink-0 self-start sm:self-auto"
            >
              {busy ? t("import.analysing") : t("import.analyse")}
              {!busy ? <span aria-hidden>↓</span> : null}
            </Button>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

/** ② Choisir — selection bar + the FigureCard preview grid + the confirm CTA. */
function ReviewPhase({ candidates, selectedCount, onToggle, onSelectAll, onAssoc, onCommit, onBack, t }) {
  const full = selectedCount >= BATCH_MAX;
  return (
    <div>
      {/* Selection ledger — count (gold, turns red at the cap) + select-all/none. */}
      <div className="sticky top-2 z-30 mb-6 flex flex-wrap items-center gap-3 p-3 border border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-noir-deep)_82%,transparent)] backdrop-blur-md">
        <span className="display text-xl leading-none">
          <b
            className="figural"
            style={{ color: full ? "var(--color-laque-bright)" : "var(--color-or-pale)" }}
          >
            {selectedCount}
          </b>
          <span className="text-[var(--color-ivoire-soft)]"> / {BATCH_MAX}</span>{" "}
          <span className="micro-tight align-middle">{t("import.selected")}</span>
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onSelectAll(true)}
          className="tap-target px-3 text-[10px] uppercase tracking-[0.2em] text-[var(--color-or-pale)] border border-[color-mix(in_oklab,var(--color-or)_30%,transparent)] hover:border-[var(--color-or)] hover:text-[var(--color-or)] transition-colors"
        >
          {t("import.select_all")}
        </button>
        <button
          type="button"
          onClick={() => onSelectAll(false)}
          className="tap-target px-3 text-[10px] uppercase tracking-[0.2em] text-[var(--color-ivoire-soft)] border border-[color-mix(in_oklab,var(--color-or)_20%,transparent)] hover:text-[var(--color-laque-bright)] hover:border-[color-mix(in_oklab,var(--color-laque-bright)_45%,transparent)] transition-colors"
        >
          {t("import.select_none")}
        </button>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {candidates.map((c, i) => (
          <Reveal as="li" key={c.detail_url || i} delay={Math.min(i, 7) * 0.04} y={20}>
            <CandidateCard
              c={c}
              onToggle={() => onToggle(i)}
              onAssoc={(v) => onAssoc(i, v)}
              t={t}
            />
          </Reveal>
        ))}
      </ul>

      <div className="gold-rule w-full opacity-50 mt-10 mb-6" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button variant="ghost" onClick={onBack}>
          <span aria-hidden>←</span> {t("import.back")}
        </Button>
        <Button
          variant="primary"
          onClick={onCommit}
          disabled={selectedCount === 0}
        >
          {t("import.commit", { n: selectedCount })} <span aria-hidden>→</span>
        </Button>
      </div>
    </div>
  );
}

/** One parsed item, mounted as a FigureCard specimen with an include/exclude
 *  seal in the corner and the catalogue-association controls below. */
function CandidateCard({ c, onToggle, onAssoc, t }) {
  const skip = c.action === "skip";
  const score = c.best ? pct(c.best.score) : null;
  // Map the match status onto a FigureCard `badge` (tone drives the sash):
  //   match → gold "auto" · low → red "check" · new → red "new" ·
  //   owned/wished → neutral lock-out marker.
  const badge = {
    label: t(`import.chip.${c.status}`),
    tone:
      c.status === "match"
        ? "imminent" // gold sash — reserved here for a confident catalogue hit
        : c.status === "owned" || c.status === "wished"
          ? "neutral"
          : "preorder", // hanko-red sash for new / to-verify
  };

  const sub = [c.studio, c.version, c.price].filter(Boolean).join(" · ");

  return (
    <div
      className="relative h-full transition-opacity"
      style={{ opacity: skip ? 0.55 : 1 }}
    >
      {/* Include / exclude seal — gold when in, hollow when out. Locked items
          (owned/wished) render an inert hanko-red ✕ instead. */}
      {skip ? (
        <span
          aria-hidden
          className="absolute top-3 left-3 z-[7] tap-target w-9 h-9 grid place-items-center text-sm bg-[color-mix(in_oklab,var(--color-noir-deep)_80%,transparent)] border border-[color-mix(in_oklab,var(--color-laque-bright)_45%,transparent)] text-[var(--color-laque-bright)]"
        >
          ✕
        </span>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={c.selected}
          aria-label={t("import.toggle")}
          className="absolute top-3 left-3 z-[7] tap-target w-9 h-9 grid place-items-center text-sm transition-colors"
          style={{
            background: c.selected
              ? "var(--color-or)"
              : "color-mix(in oklab, var(--color-noir-deep) 78%, transparent)",
            border: `1px solid ${c.selected ? "var(--color-or)" : "color-mix(in oklab, var(--color-or) 45%, transparent)"}`,
            color: c.selected ? "var(--color-noir)" : "transparent",
          }}
        >
          ✓
        </button>
      )}

      <div
        className={`block h-full ${c.selected && !skip ? "outline outline-2 outline-[var(--color-or)]" : ""}`}
      >
        <FigureCard
          name={c.title}
          manufacturer={c.studio}
          versionName={c.version}
          imageUrl={c.image_url}
          badge={badge}
        />
      </div>

      {/* Association ledger under the card — score + the catalogue picker or the
          "will be created" / lock-out note. */}
      <div className="mt-3 px-1 space-y-2">
        {score != null && (c.status === "match" || c.status === "low") ? (
          <div className="flex items-center justify-between gap-3">
            <span className="micro-tight">{t("import.match_label", { default: "CORRESPONDANCE" })}</span>
            <span
              className="figural text-lg leading-none"
              style={{
                color: c.status === "match" ? "var(--color-or-pale)" : "var(--color-laque-bright)",
              }}
            >
              {score}%
            </span>
          </div>
        ) : null}

        {!skip ? (
          c.matches.length > 0 ? (
            <label className="block">
              <span className="micro-tight block mb-1.5">
                {t("import.assoc_label", { default: "ASSOCIER À" })}
              </span>
              <select
                className="w-full bg-[var(--color-noir)] border border-[var(--color-or)]/30 px-3 py-2 text-[13px] text-[var(--color-ivoire)] outline-none focus:border-[var(--color-or)] transition-colors"
                style={{ fontFamily: "var(--font-sans)" }}
                value={c.action === "link" ? c.chosenFigureId : "__new__"}
                onChange={(e) => onAssoc(e.target.value)}
              >
                <option value="__new__">{t("import.create_new")}</option>
                {c.matches.map((m) => (
                  <option key={m.figure_id} value={m.figure_id}>
                    {m.name} ({pct(m.score)}%)
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-[11px] leading-relaxed text-[var(--color-or-pale)] border-l-2 border-[color-mix(in_oklab,var(--color-or)_35%,transparent)] pl-2.5">
              {t("import.will_create")}
            </p>
          )
        ) : (
          <p className="text-[11px] leading-relaxed text-[var(--color-laque-bright)] border-l-2 border-[color-mix(in_oklab,var(--color-laque-bright)_45%,transparent)] pl-2.5">
            {c.status === "owned" ? t("import.status.owned") : t("import.status.wished")}
          </p>
        )}

        {sub ? (
          <p className="text-[11px] text-[var(--color-ivoire-soft)] font-mono truncate" title={sub}>
            {sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** ③ Import en cours — a gold progress bar under the kanji-marked Card. */
function ImportingPhase({ progress, t }) {
  const frac = progress.total ? progress.done / progress.total : 0;
  const pctDone = Math.round(frac * 100);
  return (
    <Reveal as="div">
      <Card className="relative overflow-hidden p-6 md:p-8">
        <span aria-hidden className="kanji-mark text-[10rem] -top-8 -right-2 select-none">輸</span>
        <div className="relative">
          <p className="micro flex items-center gap-2">
            <span className="ja not-italic text-base text-[var(--color-or)] leading-none" aria-hidden>輸</span>
            {t("import.phase.importing")}
          </p>
          <div className="gold-rule w-16 mt-4 mb-6" />

          <div
            className="h-1.5 w-full bg-[color-mix(in_oklab,var(--color-or)_12%,transparent)] overflow-hidden"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total || 0}
            aria-valuenow={progress.done}
          >
            <span
              className="block h-full bg-[var(--color-or)] transition-[width] duration-300"
              style={{ width: `${pctDone}%` }}
            />
          </div>
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="text-sm text-[var(--color-ivoire-soft)] truncate" title={progress.label}>
              {progress.label}
            </span>
            <span className="figural text-lg text-[var(--color-or-pale)] shrink-0">
              {progress.done} / {progress.total}
            </span>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

/** Terminé — a summary ledger (gold = created/linked value, red = errors) and
 *  the red CTA back to the wishlist. */
function DonePhase({ summary, onReset, t }) {
  const s = summary ?? { created: 0, linked: 0, errors: 0 };
  return (
    <Reveal as="div">
      <Card className="relative overflow-hidden p-6 md:p-8 text-center">
        <span aria-hidden className="kanji-mark text-[12rem] -top-10 -right-4 select-none">蒐</span>
        <div className="relative">
          <p className="micro">{t("import.phase.done")}</p>
          <div className="gold-rule mx-auto w-20 mt-4 mb-8" />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-xl mx-auto">
            <SummaryStat value={s.created} label={t("import.sum.created")} tone="gold" />
            <SummaryStat value={s.linked} label={t("import.sum.linked")} tone="gold" />
            {s.errors > 0 ? (
              <SummaryStat value={s.errors} label={t("import.sum.errors")} tone="red" />
            ) : null}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button variant="ghost" onClick={onReset}>
              {t("import.again")}
            </Button>
            <Link to="/souhaits">
              <Button variant="primary">
                {t("import.to_wishlist")} <span aria-hidden>→</span>
              </Button>
            </Link>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

/** A single result tally — gold for created/linked value, hanko-red for errors. */
function SummaryStat({ value, label, tone }) {
  const accent = tone === "red" ? "var(--color-laque-bright)" : "var(--color-or-pale)";
  return (
    <div
      className="p-4 border"
      style={{
        borderColor:
          tone === "red"
            ? "color-mix(in oklab, var(--color-laque-bright) 40%, transparent)"
            : "color-mix(in oklab, var(--color-or) 28%, transparent)",
        background:
          tone === "red"
            ? "color-mix(in oklab, var(--color-laque) 8%, transparent)"
            : "color-mix(in oklab, var(--color-or) 6%, transparent)",
      }}
    >
      <div className="figural text-4xl leading-none" style={{ color: accent }}>
        {value}
      </div>
      <div className="micro-tight mt-2">{label}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Crude HTML sniff — distinguishes a pasted page source from URL(s). */
function looksLikeHtml(s) {
  return /<\s*(tr|table|div|html|body)\b/i.test(s) || s.includes("wlfmc-table-item");
}

/** De-slug a `/product/<slug>/` URL into a rough title for matching/display
 *  when we only have the link (manual product-URL paste). */
function urlToTitle(url) {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return slug.replace(/-/g, " ").trim();
  } catch {
    return url;
  }
}

/** Trigram score (0..~1.08) → display percent, capped at 100. */
function pct(score) {
  return Math.min(100, Math.round((score ?? 0) * 100));
}
