# Redesign kit — how to rebuild a page on the new foundation

Shared reference for every page-redesign agent. Goal: rebuild pages to be
**prettier, more practical, modern** while staying 100 % Direction A
"Shōjo-Noir" and keeping the app green. Read this + your page-specific brief.

## The golden rule (parallel-safety)
You may edit **only your assigned page file(s)** and **create page-local
sub-components** (in a sibling folder, e.g. `src/pages/collection/`). You must
**NOT** edit any shared file: `src/index.css`, `src/i18n/locales/*`,
`src/lib/navConfig.js`, anything in `src/components/ui/**` or
`src/components/layout/**`, `AppShell.jsx`, or other pages. Those are done.

## Foundation you compose (do NOT reinvent)
Import primitives from the barrel (tree-shaken, so import only what you use):

```jsx
import {
  Button, IconButton, Modal, Drawer, Tabs, SegmentedControl,
  Badge, Chip, DataTable, Pagination, Breadcrumbs, Avatar, Tooltip,
  DropdownMenu, FormField, Input, Textarea, Select, Checkbox, Switch,
  Radio, RadioGroup, Spinner, Icon, useToast,
  Card, StatCard, AccentTitle, EmptyState,
} from "../components/ui/index.js";            // from src/pages/*.jsx
import { PageLayout, Section, Toolbar } from "../components/layout/index.js";
// page-local sub-components import with one more "../": "../../components/ui/index.js"
```

Icons: `lucide-react` (e.g. `import { Plus, Search } from "lucide-react"`), 1.21
naming (`CircleCheck`, `CircleAlert`, `TriangleAlert`, `Trash2`, `Pencil`…).
Reuse existing domain components too: `FigureCard`, `Money`, `Reveal`
(`components/motion/Reveal.jsx`), `ConfirmDialog`, `Lightbox`, `Skeleton`.

### PageLayout — the standard frame (replaces hand-rolled headers)
```jsx
<AppShell>
  <PageLayout
    kicker="COLLECTION · 蒐 · MES PIÈCES"
    title={t("collection.title", { default: "Ma collection" })}
    kanji="蒐"
    toolbar={<Button iconStart={<Plus size={16} />}>Ajouter</Button>}
    width="standard"            // "prose" | "standard" | "wide"
  >
    <Section title="…" kicker="…" actions={…} divider>
      …grid / table / cards…
    </Section>
  </PageLayout>
</AppShell>
```
`title` is rendered through `<AccentTitle>` (red italic first word — the
signature). Keep `<AppShell>` as the outer wrapper exactly as the page does today.

## Design tokens (use these, never hardcode hex)
Surfaces `--surface` `--surface-raised` `--surface-sunken` · text `--on-surface`
`--on-surface-muted` `--on-surface-subtle` · `--border` `--border-strong`
`--border-subtle` · brand `--primary` `--primary-hover` · `--accent` (gold,
value) · status `--danger` `--success` `--warning` `--info` (+ `*-surface`
tints) · `--radius-sm|md|lg|pill` · `--elevation-1..4` · `--z-*` · `--dur-fast|base`
· easings `--ease-curtain|quick|spring`. Per-type figure hue via `lib/typeHue.js`.
Consume in Tailwind arbitrary values `bg-[var(--surface)]` or inline `style`.

## Hard rules (Direction A playbook)
1. **Hanko red = the single hot accent** (CTA / active / urgency / loss). **Gold
   = value/money only.** Quiet chrome; the figure photography carries colour.
2. **Figurine metrics only** — Pièces · Valeur/cote · Pré-commandes/acomptes ·
   Vitrines · Fabricants · Types · Souhaits. NO manga "completion". Money via
   `lib/money.js` + `<Money>`.
3. **GPU-light**: flat fills, static gradients, hairlines. No animated
   backgrounds, no `filter:` glows, no `backdrop-filter` (the header's is the
   only one). Hover/enter transitions + `Reveal` are fine. Honour
   `prefers-reduced-motion`.
4. **Responsive parity**: design desktop AND mobile. Collapse multi-column grids
   to one column on mobile; wide tables/charts scroll inside their own
   `overflow-x:auto` well (the page never side-scrolls); ≥44px touch targets.
5. **a11y**: visible labels, error below field, focus-visible, alt text,
   `aria-*`; one primary CTA per page (others ghost/subtle).
6. **Keep it working**: reuse the page's existing data hooks / mutations / props
   — restyle + restructure the JSX, don't change the data layer or routes.
7. **New copy**: reuse existing i18n keys; for new strings use
   `t("some.key", { default: "Texte FR" })` and LIST invented keys in your
   summary (do not edit locale files).

## Decompose the mega-pages
Turn a 1000–1500-line page into a thin orchestrator (data hooks + state +
composition) plus ~5–8 focused sub-components in a page-local folder. Add proper
empty / loading / error states (compose `EmptyState`, `Skeleton`).

## Build / lint (cwd MUST be `client/`)
The repo pins pnpm (corepack refuses it) and `pnpm dev|build` downloads ~380 MB
of ML assets — **do NOT use pnpm**. Use binaries directly. **Do NOT run
`vite build`** (the integrator builds the whole app after the wave to avoid
concurrent `dist/` clashes). You MAY lint your own file:
```
cd <worktree>/client && node_modules/.bin/eslint src/pages/YourPage.jsx
```
Leave the 39 pre-existing warnings (RecognizePage/SettingsPage/BrowsePage) alone.

## Orientation
Project hook: `graphify-out/graph.json` exists — run `graphify query "<q>"` /
`graphify explain "<concept>"` to orient before reading source; read raw files
only to modify/debug specific lines.
