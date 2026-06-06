# Direction A — "Shōjo-Noir" · bespoke redesign playbook

The shared spec every page-redesign follows so ~40 bespoke pages stay coherent.
Inspired by [MangaCollector](https://github.com/Dim145/MangaCollector): warm
editorial dark, hanko red as the single hot accent, gold for value.

## Identity
Calm, premium, editorial. Warm ink-black canvas, **hanko red (朱)** as the only
hot accent, **gold (金)** reserved for value/money, ivoire text. Fraunces display
+ Instrument Sans body. Kanji micro-touches. The figure/photography carries the
colour; chrome stays quiet. Dark-first (a light "porcelain" theme exists — keep
everything theme-var driven so it flips).

## Tokens (CSS vars — never hardcode hex)
`--color-noir` (page) · `--color-noir-soft` (cards) · `--color-noir-deep` (wells)
· `--color-laque` / `--color-laque-bright` (hanko red — CTAs, active, accent word,
loss/error) · `--color-or` / `--color-or-pale` / `--color-or-deep` (gold — value,
rules, hairlines) · `--color-ivoire` / `--color-ivoire-soft` (text) · per-type hues
via `lib/typeHue.js`. Fonts: `--font-display` (Fraunces), `--font-sans` (Instrument
Sans), `--font-ja` (Noto Serif JP), `--font-mono` (JetBrains Mono).

## Reuse these components (do NOT reinvent)
- `AppShell` — authed pages wrap in it (header + footer + aurora). Public/standalone
  pages (login/register/landing) do NOT use it.
- `AccentTitle` (`components/AccentTitle.jsx`) — `<AccentTitle text={t(...)} />`
  renders the **leading word in red italic** = the signature headline. Put on an
  `.display` h1.
- `StatCard` (`components/StatCard.jsx`) — `<StatCard label value sub tone />`
  (tone: `gold` | `red` | default). Use in a `grid grid-cols-2 lg:grid-cols-4 gap-3`
  for stat strips. Numbers are figurine metrics (see Rules).
- `Button` (red hanko pill primary / gold-outline ghost), `Card`, `FormField`.
- `FigureCard` for figure grids.

## Reuse these utility classes (in index.css — do NOT add new global CSS)
`.display` `.display-italic` (Fraunces) · `.ja` (kanji) · `.micro` `.micro-tight`
(uppercase tracked kicker labels) · `.label-mono` · `.gold-rule` (`w-24` divider)
· `.kanji-mark` (huge faint watermark — position it) · `.seigaiha` (ukiyo-e wave
veil; mask-fade it) · `.fc-card` · `.figural` (oldstyle nums). Everything else =
Tailwind utilities + inline `style` with `var(--color-*)` / `color-mix(in oklab, …)`.

## Page patterns
- **Editorial header**: `.micro` kicker (often `KICKER · 漢字 · LABEL`) → `.display`
  h1 with `<AccentTitle>` → `.gold-rule w-24`. Optional `.kanji-mark` watermark
  bleeding off a corner.
- **Stat strip**: a `StatCard` grid right under the header (figurine metrics).
- **Standalone pages** (login/register/auth/landing/404): editorial **split** —
  brand panel (kanji-mark 像 + lockup + kicker + AccentTitle + gloss + JP tagline +
  `.seigaiha` foot) on lg, form/content panel beside it; collapse to a compact
  header on mobile. **Reference: `pages/LoginPage.jsx`.**
- **Section dividers**: `.gold-rule` or a kicker label; kanji section markers ok.
- **CTAs**: `<Button variant="primary">` (red pill). Gold only for value figures.
- **Empty states**: a `Card` with a faint kanji watermark + accent eyebrow + title
  + `.gold-rule` + a red CTA (see `CollectionPage` EmptyState).

## Hard rules
1. **Figurine metrics only — NO manga "completion"/series-completion.** Use
   Pièces · Valeur/cote · Pré-commandes/acomptes · Vitrines · Fabricants · Types ·
   Souhaits. Value via `lib/money.js` (per-currency, no FX). Kanji: 棚 (shelf),
   蒐集 (collecting), 予約 (preorder) — never 本棚 / あらすじ.
2. **GPU-light.** Flat fills, static gradients, hairlines. No animated background
   meshes, no `backdrop-filter: blur` (except a small sticky bar), no `filter:`
   glows, no continuous animations. Honour `prefers-reduced-motion`. Hover/enter
   transitions + the existing `Reveal` motion are fine.
3. **Don't edit shared files in parallel work.** Edit only your assigned page file
   (+ create a page-local sub-component if helpful). Do NOT touch `index.css` or
   `i18n/locales/*`. For new copy, reuse existing keys, or
   `t("some.key", { default: "Texte FR" })` — list the keys you invented so they
   get backfilled centrally.
4. **Keep it working.** Don't break data hooks, routes, or props. Reuse the page's
   existing data/logic; restyle + restructure the JSX only.
5. **Responsive + a11y**: collapse grids on mobile; preserve labels, focus, alt,
   `aria-*`; ≥44px touch targets (`.tap-target`).

## Reference files
`pages/LoginPage.jsx` (split standalone), `pages/CollectionPage.jsx` (header +
AccentTitle + StatCard strip + kanji-mark + filter rail), `pages/PreordersPage.jsx`
(horarium timeline), the 4 mockups in `docs/design/redesign-*.html` (A = shojo-noir).
