import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useFigures, useOwnedItems } from "../hooks/useCollection.js";
import { useVisualSearchStatus } from "../hooks/useVisualSearch.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { SECTIONS, ACCOUNT_NAV, PALETTE_ACTIONS } from "../lib/navConfig.js";

/**
 * Command palette opened with ⌘K / Ctrl+K.
 *
 * Lightweight fuzzy match (subsequence + token-prefix) over four groups:
 *   - Navigation — every section + its sub-pages + the account destinations,
 *     sourced from navConfig so the palette never drifts from the chrome.
 *   - Actions — long-tail tasks from navConfig.PALETTE_ACTIONS (scan a
 *     barcode, photo search, export the insurance dossier, …). Selecting one
 *     navigates to its `to`.
 *   - My collection (owned items)
 *   - Catalog (all figures)
 *
 * No external fuse.js dependency: keeps the bundle slim and the matching
 * behaviour fully under our control.
 */
export default function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  // Focus trap: Tab cycles between the input + result items + close button.
  // Esc restores focus to whatever element opened the palette (matters
  // when ⌘K was triggered from a button via aria, not the keyboard
  // shortcut itself).
  useFocusTrap(dialogRef, {
    active: open,
    onClose: () => setOpen(false),
  });

  // The palette is mounted on every page (App.jsx) so eagerly firing
  // `useOwnedItems()` + `useFigures()` would fan out two queries on every
  // route change — even though the palette stays closed 99 % of the time.
  // Gate them on `open` so the cost is paid only when the user actually
  // hits ⌘K. Once the data lands the cache keeps it hot for subsequent
  // openings; TanStack Query won't refetch unless its staleTime expired.
  const owned = useOwnedItems({ enabled: open });
  const figures = useFigures({}, { enabled: open });
  // Cheap: AppShell already primed this query, so opening the palette reads
  // it from cache. Gates the photo-search command on the feature flag.
  const visualSearch = useVisualSearchStatus({ enabled: open });

  // Global ⌘K / Ctrl+K toggle
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        setOpen((x) => !x);
      } else if (k === "escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // External "open me" trigger — dispatched by the ⌘K chip in AppShell so
  // it can mimic the keyboard shortcut without prop-drilling. Toggling
  // matches the keyboard shortcut's behaviour: click while open closes.
  useEffect(() => {
    const onOpenEvent = () => setOpen((x) => !x);
    window.addEventListener("figurecollector:toggle-palette", onOpenEvent);
    return () => window.removeEventListener("figurecollector:toggle-palette", onOpenEvent);
  }, []);

  // Auto-focus on open + reset selection
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const flagEnabled = useMemo(
    () => ({ visualSearch: !!visualSearch.data?.enabled }),
    [visualSearch.data?.enabled],
  );

  const items = useMemo(() => {
    // Navigation — every section + its sub-pages + account destinations, from
    // navConfig. A child whose `flag` isn't enabled (e.g. photo search on an
    // instance without it) is dropped so the palette never offers a dead page.
    const navigation = [{ id: "nav-home", group: "navigation", label: t("nav.home"), to: "/" }];
    for (const section of SECTIONS) {
      navigation.push({
        id: `nav-${section.id}`,
        group: "navigation",
        label: t(section.labelKey, { default: section.labelDefault }),
        to: section.to,
      });
      for (const child of section.children ?? []) {
        if (child.to === section.to) continue; // the index child == the section root
        if (child.flag && !flagEnabled[child.flag]) continue;
        navigation.push({
          id: `nav-${section.id}-${child.to}`,
          group: "navigation",
          label: t(child.labelKey, { default: child.labelDefault }),
          to: child.to,
        });
      }
    }
    for (const acc of ACCOUNT_NAV) {
      navigation.push({
        id: `nav-account-${acc.to}`,
        group: "navigation",
        label: t(acc.labelKey, { default: acc.labelDefault }),
        to: acc.to,
      });
    }

    // Actions — long-tail tasks. Same flag gate (none today, but cheap to keep).
    const actions = PALETTE_ACTIONS.filter((a) => !a.flag || flagEnabled[a.flag]).map((a) => ({
      id: `action-${a.id}`,
      group: "actions",
      label: t(a.labelKey, { default: a.labelDefault }),
      to: a.to,
    }));

    const collectionItems =
      owned.data?.map((o) => ({
        id: `owned-${o.id}`,
        group: "collection",
        label: o.figure_name,
        meta: o.manufacturer_name,
        to: `/figures/${o.figure_id}`,
      })) ?? [];

    const catalogItems =
      figures.data?.map((f) => ({
        id: `figure-${f.id}`,
        group: "catalog",
        label: f.name,
        meta: t(`type.${f.figure_type}`),
        to: `/figures/${f.id}`,
      })) ?? [];

    return [...navigation, ...actions, ...collectionItems, ...catalogItems];
  }, [t, owned.data, figures.data, flagEnabled]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const needle = query.trim().toLowerCase();
    return items
      .map((it) => ({ ...it, _score: score(it.label, needle) }))
      .filter((it) => it._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 40);
  }, [items, query]);

  const groups = useMemo(() => {
    const out = { navigation: [], actions: [], collection: [], catalog: [] };
    filtered.forEach((it) => out[it.group]?.push(it));
    return out;
  }, [filtered]);

  // Keep selected index in range
  useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
  }, [filtered, selected]);

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(filtered.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selected];
      if (item) {
        navigate(item.to);
        setOpen(false);
      }
    }
  };

  if (!open) return null;

  const onSelect = (it) => {
    navigate(it.to);
    setOpen(false);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 grid grid-cols-1 place-items-start pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div className="absolute inset-0 bg-[var(--color-noir)]/85 backdrop-blur-sm" aria-hidden />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative w-full max-w-xl min-w-0 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40"
          style={{ boxShadow: "0 40px 90px -40px rgba(0,0,0,0.85)" }}
        >
          <div className="flex items-center gap-3 border-b border-[var(--color-or)]/20 px-5 py-4">
            <span className="text-[var(--color-or)]" aria-hidden>
              ⌘K
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("palette.placeholder")}
              aria-label={t("palette.placeholder")}
              className="flex-1 min-w-0 bg-transparent text-[var(--color-ivoire)] outline-none placeholder:text-[var(--color-ivoire-soft)]"
              style={{ fontFamily: "var(--font-sans)" }}
            />
          </div>

          <div className="max-h-[60vh] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <p className="text-center text-[var(--color-ivoire-soft)] py-8 text-sm">
                {t("palette.no_results")}
              </p>
            ) : (
              <>
                <Group
                  title={t("palette.group.navigation")}
                  items={groups.navigation}
                  filtered={filtered}
                  selected={selected}
                  onSelect={onSelect}
                />
                <Group
                  title={t("palette.group.actions", { default: "Actions" })}
                  items={groups.actions}
                  filtered={filtered}
                  selected={selected}
                  onSelect={onSelect}
                />
                <Group
                  title={t("palette.group.collection")}
                  items={groups.collection}
                  filtered={filtered}
                  selected={selected}
                  onSelect={onSelect}
                />
                <Group
                  title={t("palette.group.catalog")}
                  items={groups.catalog}
                  filtered={filtered}
                  selected={selected}
                  onSelect={onSelect}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Group({ title, items, filtered, selected, onSelect }) {
  if (items.length === 0) return null;
  return (
    <div className="pb-2">
      <p className="micro px-5 pt-3 pb-2">{title}</p>
      <ul>
        {items.map((it) => {
          const idx = filtered.indexOf(it);
          const isActive = idx === selected;
          return (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onSelect(it)}
                onMouseEnter={() => {
                  /* no-op; keyboard owns selection */
                }}
                className={`w-full flex items-center justify-between gap-4 px-5 py-2 text-left transition-colors ${
                  isActive
                    ? "bg-[var(--color-or)]/10 text-[var(--color-ivoire)]"
                    : "text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className={isActive ? "text-[var(--color-or)] mr-2" : "mr-2 opacity-40"}>
                    ›
                  </span>
                  {it.label}
                </span>
                {it.meta ? <span className="micro shrink-0 opacity-70">{it.meta}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Lightweight fuzzy score. Higher = better match. */
function score(haystack, needle) {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  if (h === needle) return 1000;
  if (h.startsWith(needle)) return 800;
  if (h.includes(needle)) return 500;

  // Subsequence match: every char of needle in order somewhere in haystack.
  let hi = 0;
  let matches = 0;
  for (const c of needle) {
    const found = h.indexOf(c, hi);
    if (found === -1) return 0;
    hi = found + 1;
    matches += 1;
  }
  return 100 + matches * 5;
}
