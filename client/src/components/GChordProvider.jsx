import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

/**
 * `g`-chord navigation, MangaCollector-style. Press `g` then within ~1.2s:
 *   g d → /                  (dashboard)
 *   g l → /collection        (library)
 *   g c → /catalogue         (catalog)
 *   g p → /collection/preorders   (pre-orders)
 *   g a → /community/activity     (activity)
 *   g y → /insights/year     (year-in-review)
 *   g x → /achievements      (sceaux)
 *   g k → /insights          (statistiques / KPI)
 *   g s → /settings          (settings)
 *   g ? → toggles a help overlay listing every chord
 *
 * The provider mounts a global keydown listener and renders the help overlay
 * itself when ?-chord is fired. Skips capture while typing in inputs/textareas.
 */
const CHORDS = {
  d: { to: "/", label: "Accueil" },
  l: { to: "/collection", label: "Ma collection" },
  c: { to: "/catalogue", label: "Catalogue" },
  p: { to: "/collection/preorders", label: "Pré-commandes" },
  a: { to: "/community/activity", label: "Activité" },
  y: { to: () => `/insights/year/${new Date().getFullYear()}`, label: "Bilan de l'année" },
  x: { to: "/achievements", label: "Sceaux" },
  k: { to: "/insights", label: "Statistiques" },
  s: { to: "/settings", label: "Paramètres" },
  n: { to: "/figures/new", label: "Nouvelle figurine" },
};

const CHORD_TIMEOUT_MS = 1200;

export default function GChordProvider() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let resetTimer = null;

    const isTypingTarget = (el) =>
      el?.tagName === "INPUT" ||
      el?.tagName === "TEXTAREA" ||
      el?.tagName === "SELECT" ||
      el?.isContentEditable;

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;

      const k = e.key?.toLowerCase();
      if (!k) return;

      if (pending) {
        // We're in the second-key window.
        clearTimeout(resetTimer);
        setPending(false);

        if (k === "?") {
          e.preventDefault();
          setHelp((x) => !x);
          return;
        }

        const chord = CHORDS[k];
        if (chord) {
          e.preventDefault();
          const target = typeof chord.to === "function" ? chord.to() : chord.to;
          navigate(target);
        }
        return;
      }

      if (k === "g") {
        e.preventDefault();
        setPending(true);
        resetTimer = setTimeout(() => setPending(false), CHORD_TIMEOUT_MS);
      } else if (k === "escape" && help) {
        setHelp(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(resetTimer);
    };
  }, [pending, help, navigate]);

  return (
    <>
      {pending ? <PendingPill /> : null}
      {help ? <HelpOverlay onClose={() => setHelp(false)} /> : null}
    </>
  );
}

function PendingPill() {
  return (
    <div aria-hidden className="fixed bottom-6 left-6 z-50 pointer-events-none">
      <span className="px-3 py-1 bg-[var(--color-noir-soft)] border border-[var(--color-or)] text-[var(--color-or)] text-[10px] uppercase tracking-[0.25em] font-mono">
        g _
      </span>
    </div>
  );
}

function HelpOverlay({ onClose }) {
  return createPortal(
    <div
      role="dialog"
      aria-modal
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/85 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-noir-soft)] border border-[var(--color-or)]/40 p-8 max-w-md w-[90vw]"
        style={{ boxShadow: "0 40px 90px -40px rgba(0,0,0,0.85)" }}
      >
        <header className="mb-5">
          <p className="micro">Navigation clavier</p>
          <h2 className="display text-2xl text-[var(--color-ivoire)] mt-1">g-chord</h2>
          <div className="gold-rule w-24 mt-4" />
        </header>

        <ul className="space-y-2 text-sm">
          {Object.entries(CHORDS).map(([k, c]) => (
            <li key={k} className="flex items-center justify-between gap-4">
              <span className="text-[var(--color-ivoire)]">{c.label}</span>
              <kbd className="font-mono text-[11px] tracking-wider px-2 py-0.5 border border-[var(--color-or)]/40 text-[var(--color-or)]">
                g {k}
              </kbd>
            </li>
          ))}
          <li className="flex items-center justify-between gap-4 mt-3 pt-3 border-t border-[var(--color-or)]/15">
            <span className="text-[var(--color-ivoire-soft)]">Cette aide</span>
            <kbd className="font-mono text-[11px] tracking-wider px-2 py-0.5 border border-[var(--color-or)]/40 text-[var(--color-or)]">
              g ?
            </kbd>
          </li>
        </ul>

        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-ivoire-soft)] mt-6 text-center">
          Échap pour fermer
        </p>
      </div>
    </div>,
    document.body,
  );
}
