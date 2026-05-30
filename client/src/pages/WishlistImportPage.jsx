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
import AppShell from "../components/AppShell.jsx";

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
      <main className="relative max-w-4xl mx-auto px-6 py-14">
        <header className="relative mb-8">
          <span aria-hidden className="kanji-mark text-[18rem] -top-20 right-0 select-none">蒐</span>
          <p className="micro">{t("import.eyebrow")}</p>
          <h1 className="display text-4xl md:text-5xl text-[var(--color-ivoire)] mt-2">
            {t("import.title")}
          </h1>
          <div className="gold-rule w-16 mt-4" />
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
            {t("import.subtitle")}
          </p>
        </header>

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

function Steps({ phase, t }) {
  const order = ["input", "review", "done"];
  const cur = phase === "importing" ? 2 : order.indexOf(phase);
  const labels = [t("import.step.paste"), t("import.step.choose"), t("import.step.import")];
  return (
    <div className="imp-steps">
      {labels.map((label, i) => (
        <span key={i} className="contents">
          <span className={`imp-step ${i === cur ? "is-on" : ""}`}>
            <span className="imp-step-n">{i < cur ? "✓" : i + 1}</span>
            {label}
          </span>
          {i < labels.length - 1 ? <span className="imp-step-arr">→</span> : null}
        </span>
      ))}
    </div>
  );
}

function InputPhase({ raw, setRaw, onAnalyse, busy, error, t }) {
  return (
    <div className="imp-panel">
      <p className="imp-phase-tag">{t("import.phase.source")}</p>
      <textarea
        className="imp-paste"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={t("import.paste_ph")}
        spellCheck={false}
      />
      {error ? (
        <p role="alert" className="imp-error">{error}</p>
      ) : null}
      <div className="imp-actions">
        <p className="imp-hint">{t("import.paste_hint")}</p>
        <button
          type="button"
          className="imp-btn imp-btn--primary"
          onClick={onAnalyse}
          disabled={busy || !raw.trim()}
        >
          {busy ? t("import.analysing") : `${t("import.analyse")} ↓`}
        </button>
      </div>
    </div>
  );
}

function ReviewPhase({ candidates, selectedCount, onToggle, onSelectAll, onAssoc, onCommit, onBack, t }) {
  return (
    <div>
      <div className="imp-bar">
        <span className={`imp-count ${selectedCount >= BATCH_MAX ? "is-full" : ""}`}>
          <b>{selectedCount}</b> / {BATCH_MAX} {t("import.selected")}
        </span>
        <span className="imp-bar-spacer" />
        <button type="button" className="imp-lnk" onClick={() => onSelectAll(true)}>
          {t("import.select_all")}
        </button>
        <button type="button" className="imp-lnk" onClick={() => onSelectAll(false)}>
          {t("import.select_none")}
        </button>
      </div>

      <ul className="imp-list">
        {candidates.map((c, i) => (
          <CandidateRow key={c.detail_url || i} c={c} onToggle={() => onToggle(i)} onAssoc={(v) => onAssoc(i, v)} t={t} />
        ))}
      </ul>

      <div className="imp-footer">
        <button type="button" className="imp-btn imp-btn--ghost" onClick={onBack}>
          {t("import.back")}
        </button>
        <button
          type="button"
          className="imp-btn imp-btn--primary"
          onClick={onCommit}
          disabled={selectedCount === 0}
        >
          {t("import.commit", { n: selectedCount })} →
        </button>
      </div>
    </div>
  );
}

function CandidateRow({ c, onToggle, onAssoc, t }) {
  const skip = c.action === "skip";
  const score = c.best ? pct(c.best.score) : null;
  return (
    <li className={`imp-item ${c.selected ? "is-sel" : ""} ${skip ? "is-off" : ""}`}>
      <button
        type="button"
        className={`imp-cbx ${c.selected ? "on" : ""} ${skip ? "dis" : ""}`}
        onClick={onToggle}
        disabled={skip}
        aria-pressed={c.selected}
        aria-label={t("import.toggle")}
      >
        {c.selected ? "✓" : ""}
      </button>

      <span className="imp-thumb">
        {c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <span aria-hidden>蒐</span>}
      </span>

      <div className="imp-meta">
        <div className="imp-name">{c.title}</div>
        <div className="imp-sub">
          {[c.studio, c.version, c.price].filter(Boolean).join(" · ") || "—"}
        </div>
        {!skip ? (
          <div className="imp-assoc">
            {c.matches.length > 0 ? (
              <select
                className="imp-pick"
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
            ) : (
              <span className="imp-assoc-new">{t("import.will_create")}</span>
            )}
          </div>
        ) : (
          <div className="imp-assoc imp-assoc-skip">
            {c.status === "owned" ? t("import.status.owned") : t("import.status.wished")}
          </div>
        )}
      </div>

      <div className="imp-right">
        <span className={`imp-chip imp-chip--${c.status}`}>{t(`import.chip.${c.status}`)}</span>
        {score != null && (c.status === "match" || c.status === "low") ? (
          <span className={`imp-pct ${c.status === "match" ? "is-hi" : "is-lo"}`}>{score}%</span>
        ) : null}
      </div>
    </li>
  );
}

function ImportingPhase({ progress, t }) {
  const frac = progress.total ? progress.done / progress.total : 0;
  return (
    <div className="imp-panel">
      <p className="imp-phase-tag">{t("import.phase.importing")}</p>
      <div className="imp-prog">
        <i style={{ width: `${Math.round(frac * 100)}%` }} />
      </div>
      <div className="imp-prog-label">
        <span>{progress.label}</span>
        <span className="mono">{progress.done} / {progress.total}</span>
      </div>
    </div>
  );
}

function DonePhase({ summary, onReset, t }) {
  const s = summary ?? { created: 0, linked: 0, errors: 0 };
  return (
    <div className="imp-panel">
      <p className="imp-phase-tag">{t("import.phase.done")}</p>
      <div className="imp-summary">
        <div className="imp-stat cr"><b>{s.created}</b><span>{t("import.sum.created")}</span></div>
        <div className="imp-stat li"><b>{s.linked}</b><span>{t("import.sum.linked")}</span></div>
        {s.errors > 0 ? (
          <div className="imp-stat er"><b>{s.errors}</b><span>{t("import.sum.errors")}</span></div>
        ) : null}
      </div>
      <div className="imp-footer">
        <button type="button" className="imp-btn imp-btn--ghost" onClick={onReset}>
          {t("import.again")}
        </button>
        <Link to="/souhaits" className="imp-btn imp-btn--primary">
          {t("import.to_wishlist")} →
        </Link>
      </div>
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
