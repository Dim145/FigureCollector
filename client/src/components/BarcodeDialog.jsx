import { useEffect, useMemo } from "react";
import { useT } from "../i18n/index.jsx";
import Button from "./Button.jsx";

/**
 * EAN-13 / JAN-13 barcode rendering modal.
 *
 * Most figure barcodes are JAN-13 (Japanese 13-digit EAN) or EAN-13. We
 * implement the canonical encoding here — no external lib — and render the
 * bars + human-readable digits as inline SVG. That doubles as a fun bit of
 * figure-collector flair (the codes are physically printed on the box, so
 * seeing it scan-rendered onscreen is delightful).
 *
 * Anything that isn't a valid 12/13-digit numeric falls back to plain
 * monospace rendering with a "code shown verbatim" note.
 *
 * @param {object} props
 * @param {string} props.code   The raw JAN value (12 or 13 digits ideally).
 * @param {string} [props.label] Display name for the figure (for the title bar).
 * @param {() => void} props.onClose
 */
export default function BarcodeDialog({ code, label, onClose }) {
  const t = useT();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ean13 = useMemo(() => encodeEan13(code), [code]);

  return (
    <div
      className="fig-pop"
      role="dialog"
      aria-modal
      aria-labelledby="barcode-title"
      onClick={onClose}
    >
      <div className="fig-pop-card" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-baseline justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="micro">{t("barcode.eyebrow")}</p>
            <h2
              id="barcode-title"
              className="display text-2xl text-[var(--color-ivoire)] mt-1 truncate"
            >
              {label ?? t("barcode.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("editor.cancel")}
            className="text-[var(--color-ivoire-soft)] hover:text-[var(--color-or)] text-xl px-2 -mt-1"
          >
            ✕
          </button>
        </header>

        {ean13 ? (
          <BarcodeSvg digits={ean13.digits} bars={ean13.bars} />
        ) : (
          <div className="bg-[var(--color-ivoire)] text-[var(--color-noir)] py-6 px-4 text-center">
            <p className="font-mono text-2xl tracking-[0.32em]">{code}</p>
            <p className="text-[10px] uppercase tracking-[0.22em] opacity-70 mt-3">
              {t("barcode.not_ean")}
            </p>
          </div>
        )}

        <p className="micro-tight mt-4 opacity-70 break-all">{code}</p>

        <footer className="mt-6 flex items-center justify-end gap-3">
          <Button variant="primary" type="button" onClick={onClose}>
            {t("editor.cancel")}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG rendering

function BarcodeSvg({ digits, bars }) {
  // Render bars + the human-readable digits underneath. 95 modules + 22 px
  // quiet zones on each side. We use a small viewBox + preserveAspectRatio
  // so the SVG scales cleanly to whatever container width.
  const moduleW = 2.2;
  const quiet = 11;
  const totalModules = bars.length;
  const width = quiet * 2 + totalModules * moduleW;
  const barH = 78;
  const guardH = 88;
  const labelY = 100;
  const guardCols = new Set([
    // left guard: modules 0..2; centre: 45..49; right: 92..94
    0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94,
  ]);

  // Build the digit text run beneath the bars.
  // Layout: digit 0 to the left of the bars (outside the leftmost group),
  // digits 1-6 under the left half, digits 7-12 under the right half.
  return (
    <svg
      className="fig-barcode"
      viewBox={`0 0 ${width} 115`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={digits.join("")}
    >
      {bars.map((on, i) => {
        if (!on) return null;
        const h = guardCols.has(i) ? guardH : barH;
        return (
          <rect
            key={i}
            x={quiet + i * moduleW}
            y={0}
            width={moduleW}
            height={h}
          />
        );
      })}
      {/* digit 0 — left of the bars */}
      <text x={quiet - 8} y={labelY} textAnchor="end">
        {digits[0]}
      </text>
      {/* digits 1..6 — under left half */}
      {[1, 2, 3, 4, 5, 6].map((d, idx) => (
        <text
          key={d}
          x={quiet + (3 + idx * 7 + 3.5) * moduleW}
          y={labelY}
          textAnchor="middle"
        >
          {digits[d]}
        </text>
      ))}
      {/* digits 7..12 — under right half */}
      {[7, 8, 9, 10, 11, 12].map((d, idx) => (
        <text
          key={d}
          x={quiet + (50 + idx * 7 + 3.5) * moduleW}
          y={labelY}
          textAnchor="middle"
        >
          {digits[d]}
        </text>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EAN-13 encoding (kept self-contained — no external dep)

/** Returns { digits: number[13], bars: 0|1 [95] } for a valid 12 or 13-digit
 *  numeric string, or null when the input can't be encoded. When given 12
 *  digits we compute and append the check digit; when given 13 we validate it. */
function encodeEan13(raw) {
  if (!raw) return null;
  const clean = String(raw).replace(/\D+/g, "");
  if (clean.length !== 12 && clean.length !== 13) return null;
  const digits = clean.split("").map(Number);
  if (digits.length === 12) {
    digits.push(checkDigit(digits));
  } else if (checkDigit(digits.slice(0, 12)) !== digits[12]) {
    // Invalid checksum — still try to render so the user can see the code,
    // but signal "this is suspicious" by returning null.
    return null;
  }
  // The first digit determines which (L = A) / (G = B) pattern each of the
  // digits 2-7 takes for the left half. Right half is always R (= C).
  const firstDigitPattern = FIRST_DIGIT_PATTERNS[digits[0]];
  const bars = [];
  // Left guard 101
  bars.push(1, 0, 1);
  // Left half (digits 2-7, indices 1-6)
  for (let i = 1; i <= 6; i++) {
    const use = firstDigitPattern[i - 1]; // "L" or "G"
    const code = (use === "L" ? L_CODE : G_CODE)[digits[i]];
    for (const c of code) bars.push(c);
  }
  // Centre guard 01010
  bars.push(0, 1, 0, 1, 0);
  // Right half (digits 8-13, indices 7-12) — always R
  for (let i = 7; i <= 12; i++) {
    const code = R_CODE[digits[i]];
    for (const c of code) bars.push(c);
  }
  // Right guard 101
  bars.push(1, 0, 1);
  return { digits, bars };
}

function checkDigit(twelve) {
  let s = 0;
  for (let i = 0; i < 12; i++) {
    s += twelve[i] * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (s % 10)) % 10;
}

// Standard EAN-13 patterns — each digit encodes to 7 modules.
// L = left A pattern, G = left B pattern (mirrored), R = right pattern.
const L_CODE = [
  [0, 0, 0, 1, 1, 0, 1],
  [0, 0, 1, 1, 0, 0, 1],
  [0, 0, 1, 0, 0, 1, 1],
  [0, 1, 1, 1, 1, 0, 1],
  [0, 1, 0, 0, 0, 1, 1],
  [0, 1, 1, 0, 0, 0, 1],
  [0, 1, 0, 1, 1, 1, 1],
  [0, 1, 1, 1, 0, 1, 1],
  [0, 1, 1, 0, 1, 1, 1],
  [0, 0, 0, 1, 0, 1, 1],
];
const G_CODE = [
  [0, 1, 0, 0, 1, 1, 1],
  [0, 1, 1, 0, 0, 1, 1],
  [0, 0, 1, 1, 0, 1, 1],
  [0, 1, 0, 0, 0, 0, 1],
  [0, 0, 1, 1, 1, 0, 1],
  [0, 1, 1, 1, 0, 0, 1],
  [0, 0, 0, 0, 1, 0, 1],
  [0, 0, 1, 0, 0, 0, 1],
  [0, 0, 0, 1, 0, 0, 1],
  [0, 0, 1, 0, 1, 1, 1],
];
const R_CODE = [
  [1, 1, 1, 0, 0, 1, 0],
  [1, 1, 0, 0, 1, 1, 0],
  [1, 1, 0, 1, 1, 0, 0],
  [1, 0, 0, 0, 0, 1, 0],
  [1, 0, 1, 1, 1, 0, 0],
  [1, 0, 0, 1, 1, 1, 0],
  [1, 0, 1, 0, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0],
  [1, 0, 0, 1, 0, 0, 0],
  [1, 1, 1, 0, 1, 0, 0],
];
const FIRST_DIGIT_PATTERNS = [
  ["L", "L", "L", "L", "L", "L"],
  ["L", "L", "G", "L", "G", "G"],
  ["L", "L", "G", "G", "L", "G"],
  ["L", "L", "G", "G", "G", "L"],
  ["L", "G", "L", "L", "G", "G"],
  ["L", "G", "G", "L", "L", "G"],
  ["L", "G", "G", "G", "L", "L"],
  ["L", "G", "L", "G", "L", "G"],
  ["L", "G", "L", "G", "G", "L"],
  ["L", "G", "G", "L", "G", "L"],
];
