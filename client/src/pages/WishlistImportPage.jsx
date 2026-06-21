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
import {
  hostnameOf,
  proxyProductToNewFigure,
  proxyStoreFor,
  proxyWishToItem,
} from "../lib/proxyMap.js";
import { parseMfcCsv } from "../lib/mfcCsv.js";
import { useProxyEnabled, fetchProxyProduct } from "../hooks/useProxy.js";
import AppShell from "../components/AppShell.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import PageLayout from "../components/layout/PageLayout.jsx";

/**
 * « Importer dans mes souhaits » — bulk import, multi-source.
 *
 *   ① Coller   — paste a public orzgk wishlist URL (server fetches +
 *                paginates), a list URL from any boutique the operator proxy
 *                declares via `/stores`.hosts, orzgk product links, or raw
 *                HTML (private-orzgk fallback). OR drop an MFC CSV export
 *                (Manager → CSV Export) — parsed locally, matched by JAN
 *                first, no Cloudflare involved.
 *   ② Choisir  — each parsed item is matched against the catalogue (JAN exact
 *                when available, else trigram %); ≥90% auto-links,
 *                owned/already-wished are locked out, the rest default to
 *                "create new". Bulk-select up to 25.
 *   ③ Importer — matched → just wishlisted; new → created per source (orzgk
 *                detail / proxy product / minimal MFC figure with name+JAN)
 *                → wishlisted. Progress + summary.
 *
 * Direction A ("Shōjo-Noir"): editorial header (蒐/輸 kicker + AccentTitle +
 * gold-rule), the staged flow in noir Card panels, the preview as a FigureCard
 * grid with a per-item include/exclude seal. Gold for value, hanko-red for
 * actions. GPU-light: flat fills + hairlines + the shared Reveal stagger.
 */

const BATCH_MAX = 25;
const AUTO_THRESHOLD = 0.9; // ≥ → auto-associate
const SUGGEST_THRESHOLD = 0.5; // ≥ → "à vérifier" (offer the match), else "new"
/** Max queries per POST /figures/match call (the backend caps at 60). */
const MATCH_CHUNK = 60;

// Kanji seals for the detected-source chips (像 orzgk · 代 proxy · 紙 HTML).
const SOURCE_KANJI = { orzgk: "像", proxy: "代", html: "紙" };

/** Which import path the dispatcher would take for the pasted text. */
function detectSource(raw, stores) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (looksLikeHtml(text)) return { kind: "html" };
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.some((u) => /orzgk\.com\/.*(wishlist|wlfmc)/i.test(u) || ORZGK_URL_RE.test(u))) {
    return { kind: "orzgk" };
  }
  for (const u of tokens) {
    if (!/^https?:\/\//i.test(u)) continue;
    const store = proxyStoreFor(stores, hostnameOf(u));
    if (store) return { kind: "proxy", url: u, storeName: store.name };
  }
  return { kind: "unknown" };
}

export default function WishlistImportPage() {
  const t = useT();
  const me = useMe();
  const owned = useOwnedItems();
  const wishlist = useWishlistItems();
  const resolve = useResolveImport();
  const match = useFigureMatch();
  const createFigure = useCreateFigure();
  const addWish = useAddWishlistItem();
  const proxy = useProxyEnabled();

  const [raw, setRaw] = useState("");
  const [phase, setPhase] = useState("input"); // input | review | importing | done
  const [error, setError] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [summary, setSummary] = useState(null);

  const ownedIds = useMemo(() => new Set((owned.data ?? []).map((o) => o.figure_id)), [owned.data]);
  const wishedIds = useMemo(
    () => new Set((wishlist.data ?? []).map((w) => w.figure_id)),
    [wishlist.data],
  );

  const selectedCount = candidates.filter((c) => c.selected).length;
  const busy = resolve.isPending || match.isPending;
  const detected = useMemo(() => detectSource(raw, proxy.stores), [raw, proxy.stores]);
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
        items = (await resolve.mutateAsync({ html: text })).map((it) => ({
          ...it,
          source: "orzgk",
        }));
      } else {
        const tokens = text.split(/\s+/).filter(Boolean);
        const wishUrl = tokens.find((u) => /orzgk\.com\/.*(wishlist|wlfmc)/i.test(u));
        if (wishUrl) {
          items = (await resolve.mutateAsync({ url: wishUrl })).map((it) => ({
            ...it,
            source: "orzgk",
          }));
        } else if (detected?.kind === "proxy") {
          // A list URL on a boutique the operator proxy handles — forwarded
          // through the proxy's optional /wishlist contract endpoint.
          const rows = await resolve.mutateAsync({ url: detected.url, via: "proxy" });
          items = rows.map(proxyWishToItem);
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
            source: "orzgk",
          }));
        }
      }
    } catch (e) {
      setError(e?.message ?? t("import.err.fetch"));
      return;
    }
    await runPipeline(items);
  };

  // MFC CSV export (Manager → CSV Export) — parsed locally, then fed through
  // the exact same match/categorise pipeline as the URL sources.
  const onCsvFile = async (file) => {
    setError(null);
    if (!file) return;
    let items = [];
    try {
      items = parseMfcCsv(await file.text());
    } catch {
      setError(t("import.err.csv_empty"));
      return;
    }
    if (items.length === 0) {
      setError(t("import.err.csv_empty"));
      return;
    }
    await runPipeline(items);
  };

  // Shared tail of step ①: dedupe → match (JAN first, chunked) → categorise.
  const runPipeline = async (items) => {
    // Dedupe by canonical product URL.
    const seen = new Set();
    items = items.filter(
      (it) => it.detail_url && !seen.has(it.detail_url) && seen.add(it.detail_url),
    );
    if (items.length === 0) {
      setError(t("import.err.empty"));
      return;
    }

    // Match against the catalogue — exact JAN hits (MFC) come back at 100%,
    // then trigram title similarity. Chunked to the backend's 60-query cap.
    let lists = [];
    try {
      const queries = items.map((it) => ({
        name: it.title,
        manufacturer: it.studio ?? undefined,
        jan: it.jan ?? undefined,
      }));
      for (let i = 0; i < queries.length; i += MATCH_CHUNK) {
        const part = await match.mutateAsync(queries.slice(i, i + MATCH_CHUNK));
        lists.push(...part);
      }
    } catch {
      lists = items.map(() => []);
    }

    let picked = 0;
    const cands = items.map((it, i) => {
      const matches = lists[i] ?? [];
      const best = matches[0];
      let status,
        action,
        chosenFigureId = null,
        selected = false;
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
    const chosen = candidates.filter((c) => c.selected && c.action !== "skip").slice(0, BATCH_MAX);
    if (chosen.length === 0) return;

    setPhase("importing");
    setProgress({ done: 0, total: chosen.length, label: "" });
    let created = 0,
      linked = 0,
      errors = 0;

    for (const c of chosen) {
      setProgress((p) => ({ ...p, label: c.title }));
      try {
        if (c.action === "link" && c.chosenFigureId) {
          await addWish.mutateAsync({ figure_id: c.chosenFigureId });
          linked++;
        } else if (c.source === "proxy") {
          // Proxy boutique: resolve the product through the proxy contract,
          // map it with the shared proxy→NewFigure mapping (the wished
          // variant, when known, pre-selects the version like orzgk does).
          const product = await fetchProxyProduct(c.detail_url);
          const fig = await createFigure.mutateAsync(proxyProductToNewFigure(product, c.version));
          await addWish.mutateAsync({ figure_id: fig.id });
          created++;
        } else if (c.source === "mfc") {
          // MFC rows: a minimal figure (name + JAN, MFC link kept in the
          // description) — MFC is Cloudflare-walled server-side, so there's
          // no metadata to enrich with at create time.
          const fig = await createFigure.mutateAsync({
            name: c.title,
            jan: c.jan || undefined,
            description: c.detail_url.startsWith("http") ? `Source: ${c.detail_url}` : undefined,
          });
          await addWish.mutateAsync({ figure_id: fig.id });
          created++;
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
      <PageLayout
        width="standard"
        kanji="蒐"
        kicker={
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("import.eyebrow")}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">
              輸
            </span>
            {t("import.kicker_label", { default: "SOUHAITS" })}
          </span>
        }
        title={t("import.title")}
      >
        <p className="-mt-2 mb-8 max-w-2xl leading-relaxed text-[var(--color-ivoire-soft)]">
          {t("import.subtitle")}
        </p>

        <Steps phase={phase} t={t} />

        {phase === "input" ? (
          <InputPhase
            raw={raw}
            setRaw={setRaw}
            onAnalyse={analyse}
            onCsvFile={onCsvFile}
            detected={detected}
            proxy={proxy}
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

        {phase === "done" ? <DonePhase summary={summary} onReset={reset} t={t} /> : null}
      </PageLayout>
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
              <span aria-hidden className="ja text-[var(--color-or)]/40 leading-none">
                →
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/** ① Source — paste a list URL (orzgk or a proxy-handled boutique), product
 *  links, or raw HTML; or drop an MFC CSV export. A refined Direction-A
 *  textarea well + live source-detection chips + the CSV well + the CTA. */
function InputPhase({ raw, setRaw, onAnalyse, onCsvFile, detected, proxy, busy, error, t }) {
  // First few proxy-handled hostnames, as a quiet "what can I paste?" hint.
  const proxyHosts = (proxy?.stores ?? [])
    .flatMap((s) => s.hosts ?? [])
    .map((h) => (h ?? "").replace(/^www\./, ""))
    .filter(Boolean);
  const hostsHint = [...new Set(proxyHosts)].slice(0, 5).join(" · ");
  return (
    <Reveal as="div">
      <Card className="relative overflow-hidden p-6 md:p-8">
        <span aria-hidden className="kanji-mark text-[10rem] -top-8 -right-2 select-none">
          蒐
        </span>

        <div className="relative">
          <p className="micro flex items-center gap-2">
            <span
              className="ja not-italic text-base text-[var(--color-or)] leading-none"
              aria-hidden
            >
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

          {/* Live source-detection chips — which path the dispatcher will take. */}
          {raw.trim() ? (
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="micro-tight text-[var(--color-ivoire-soft)]">
                {t("import.detected")}
              </span>
              {["orzgk", "proxy", "html"].map((k) => {
                const on = detected?.kind === k;
                if (k === "proxy" && !proxy?.enabled) return null;
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 border text-[9px] uppercase tracking-[0.18em] transition-colors"
                    style={
                      on
                        ? {
                            color: "var(--color-or)",
                            borderColor: "color-mix(in oklab, var(--color-or) 60%, transparent)",
                            background: "color-mix(in oklab, var(--color-or) 10%, transparent)",
                          }
                        : {
                            color: "var(--color-ivoire-soft)",
                            borderColor: "color-mix(in oklab, var(--color-or) 22%, transparent)",
                            opacity: 0.55,
                          }
                    }
                  >
                    <span aria-hidden className="ja not-italic text-[12px] leading-none">
                      {SOURCE_KANJI[k]}
                    </span>
                    {k === "proxy" && on && detected?.storeName
                      ? t("import.source.proxy", { store: detected.storeName })
                      : t(`import.source.${k}`)}
                  </span>
                );
              })}
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 text-sm text-[var(--color-laque-bright)] tracking-wide border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-md">
              <p className="text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
                {t("import.paste_hint")}
              </p>
              {proxy?.enabled && hostsHint ? (
                <p className="mt-1.5 font-mono text-[9.5px] text-[var(--color-ivoire-soft)]/70">
                  {t("import.proxy_hosts", { hosts: hostsHint })}
                </p>
              ) : null}
            </div>
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

          {/* ── ou ── */}
          <div className="my-6 flex items-center gap-3" aria-hidden>
            <span className="flex-1 h-px bg-[color-mix(in_oklab,var(--color-or)_18%,transparent)]" />
            <span className="micro-tight text-[var(--color-ivoire-soft)]">{t("import.or")}</span>
            <span className="flex-1 h-px bg-[color-mix(in_oklab,var(--color-or)_18%,transparent)]" />
          </div>

          {/* MFC CSV well — local parse, JAN-first matching, zero scraping. */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onCsvFile(e.dataTransfer?.files?.[0]);
            }}
            className="flex items-center gap-5 p-5 border border-dashed"
            style={{ borderColor: "color-mix(in oklab, var(--color-or) 45%, transparent)" }}
          >
            <span
              aria-hidden
              className="ja not-italic text-3xl leading-none shrink-0"
              style={{ color: "color-mix(in oklab, var(--color-or) 60%, transparent)" }}
            >
              蒐
            </span>
            <div className="flex-1 min-w-0">
              <p className="micro-tight text-[var(--color-ivoire)]">{t("import.csv.title")}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ivoire-soft)]">
                {t("import.csv.hint")}
              </p>
            </div>
            <label
              className="shrink-0 tap-target cursor-pointer inline-flex items-center px-4 py-2 rounded-full border text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
              style={{ borderColor: "color-mix(in oklab, var(--color-or) 40%, transparent)" }}
            >
              {t("import.csv.browse")}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  onCsvFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      </Card>
    </Reveal>
  );
}

/** ② Choisir — selection bar + the FigureCard preview grid + the confirm CTA. */
function ReviewPhase({
  candidates,
  selectedCount,
  onToggle,
  onSelectAll,
  onAssoc,
  onCommit,
  onBack,
  t,
}) {
  const full = selectedCount >= BATCH_MAX;
  return (
    <div>
      {/* Selection ledger — count (gold, turns red at the cap) + select-all/none.
          `top` clears the AppShell sticky header + the collection sub-nav rail
          (≈5rem) so the bar docks below the chrome instead of hiding under it. */}
      <div className="sticky top-[5.25rem] z-30 mb-6 flex flex-wrap items-center gap-3 p-3 border border-[color-mix(in_oklab,var(--color-or)_28%,transparent)] bg-[color-mix(in_oklab,var(--color-noir-deep)_82%,transparent)] backdrop-blur-md">
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
        <Button variant="primary" onClick={onCommit} disabled={selectedCount === 0}>
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
    <div className="relative h-full transition-opacity" style={{ opacity: skip ? 0.55 : 1 }}>
      {/* Include / exclude seal — gold when in, hollow when out. Locked items
          (owned/wished) render an inert hanko-red ✕ instead. */}
      {/* The seal sits BELOW FigureCard's brass type plaque (absolute top-3
          left-3 z-[3]) — top-12 keeps both legible instead of stacking. */}
      {skip ? (
        <span
          aria-hidden
          className="absolute top-12 left-3 z-[7] tap-target w-9 h-9 grid place-items-center text-sm bg-[color-mix(in_oklab,var(--color-noir-deep)_80%,transparent)] border border-[color-mix(in_oklab,var(--color-laque-bright)_45%,transparent)] text-[var(--color-laque-bright)]"
        >
          ✕
        </span>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={c.selected}
          aria-label={t("import.toggle")}
          className="absolute top-12 left-3 z-[7] tap-target w-9 h-9 grid place-items-center text-sm transition-colors"
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
            <span className="micro-tight">
              {t("import.match_label", { default: "CORRESPONDANCE" })}
            </span>
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
        <span aria-hidden className="kanji-mark text-[10rem] -top-8 -right-2 select-none">
          輸
        </span>
        <div className="relative">
          <p className="micro flex items-center gap-2">
            <span
              className="ja not-italic text-base text-[var(--color-or)] leading-none"
              aria-hidden
            >
              輸
            </span>
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
            <span
              className="text-sm text-[var(--color-ivoire-soft)] truncate"
              title={progress.label}
            >
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
        <span aria-hidden className="kanji-mark text-[12rem] -top-10 -right-4 select-none">
          蒐
        </span>
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
            <Link to="/collection/souhaits">
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
