// ────────────────────────────────────────────────────────────────────────────
// Single source of truth for the app's information architecture.
//
// Consumed by AppShell (desktop primary + contextual sub-nav), MobileTabBar,
// MobileNavSheet and CommandPalette so the nav model lives in ONE place
// instead of three drifting hardcoded copies. Labels are i18n keys with a FR
// default — surfaces render them via t(labelKey, { default: labelDefault }).
//
// The new IA collapses ~30 peer routes into 4 sections + the Add CTA:
//   蒐 Collection · 目 Catalogue · 析 Insights · 縁 Communauté · ＋ Ajouter
// ────────────────────────────────────────────────────────────────────────────
import {
  Boxes,
  LayoutGrid,
  ChartColumn,
  Users,
  Plus,
  Bell,
  Settings,
  Star,
  Search,
  Camera,
  ScanBarcode,
  FileText,
  Gift,
} from "lucide-react";

/** Top-level sections (desktop primary nav + mobile tab bar roots). */
export const SECTIONS = [
  {
    id: "collection",
    to: "/collection",
    labelKey: "nav.collection",
    labelDefault: "Collection",
    kanji: "蒐",
    icon: Boxes,
    children: [
      { to: "/collection", labelKey: "nav.pieces", labelDefault: "Pièces", kanji: "像", end: true },
      {
        to: "/collection/vitrines",
        labelKey: "nav.vitrines",
        labelDefault: "Vitrines",
        kanji: "棚",
      },
      {
        to: "/collection/souhaits",
        labelKey: "wishlist.title",
        labelDefault: "Souhaits",
        kanji: "願",
      },
      {
        to: "/collection/preorders",
        labelKey: "nav.preorders",
        labelDefault: "Pré-commandes",
        kanji: "予",
      },
    ],
  },
  {
    id: "catalogue",
    to: "/catalogue",
    labelKey: "nav.catalog",
    labelDefault: "Catalogue",
    kanji: "目",
    icon: LayoutGrid,
    // No sub-nav: "Parcourir" was just /catalogue itself, and photo search is
    // reached from the camera in the catalogue search bar (plus the account
    // menu + command palette), so the two-item rail was redundant. `/catalogue/
    // photo` still maps to this section via the pathname-prefix check below.
    children: [],
  },
  {
    id: "insights",
    to: "/insights",
    labelKey: "nav.insights",
    labelDefault: "Analyses",
    kanji: "析",
    icon: ChartColumn,
    children: [
      {
        to: "/insights",
        labelKey: "nav.dashboard",
        labelDefault: "Tableau de bord",
        kanji: "計",
        end: true,
      },
      { to: "/insights/cote", labelKey: "cote.title", labelDefault: "La Cote", kanji: "価" },
      {
        to: "/insights/year",
        labelKey: "nav.yearInReview",
        labelDefault: "Rétrospective",
        kanji: "年",
      },
      {
        to: "/insights/dossier",
        labelKey: "insights.dossier.nav",
        labelDefault: "Dossier d'assurance",
        kanji: "保",
      },
    ],
  },
  {
    id: "community",
    to: "/community",
    labelKey: "nav.community",
    labelDefault: "Communauté",
    kanji: "縁",
    icon: Users,
    children: [
      {
        to: "/community",
        labelKey: "nav.discover",
        labelDefault: "Collectionneurs",
        kanji: "衆",
        end: true,
      },
      {
        to: "/community/activity",
        labelKey: "activity.title",
        labelDefault: "Journal",
        kanji: "録",
      },
      {
        to: "/community/croisements",
        labelKey: "nav.croisements",
        labelDefault: "Croisements",
        kanji: "交",
      },
    ],
  },
];

/** The central "+ Ajouter" CTA (raised seal on mobile, pill on desktop). */
export const ADD_ACTION = {
  to: "/figures/new",
  labelKey: "nav.add",
  labelDefault: "Ajouter",
  kanji: "＋",
  icon: Plus,
};

/** Account-menu destinations (avatar popover; NOT in the primary nav). */
export const ACCOUNT_NAV = [
  { to: "/achievements", labelKey: "nav.achievements", labelDefault: "Récompenses", icon: Star },
  {
    to: "/notifications",
    labelKey: "nav.notifications",
    labelDefault: "Notifications",
    icon: Bell,
  },
  { to: "/settings", labelKey: "nav.settings", labelDefault: "Réglages", icon: Settings },
];

/**
 * Long-tail actions surfaced only in the command palette (so the chrome stays
 * at 4 sections). `to` = navigate target; `event` = a window event the host
 * dispatches (for actions without a route yet).
 */
export const PALETTE_ACTIONS = [
  {
    id: "add",
    labelKey: "nav.add",
    labelDefault: "Ajouter une figurine",
    icon: Plus,
    to: "/figures/new",
  },
  {
    id: "scan",
    labelKey: "palette.scan",
    labelDefault: "Scanner un code-barres",
    icon: ScanBarcode,
    to: "/catalogue?scan=1",
  },
  {
    id: "photo",
    labelKey: "palette.photo",
    labelDefault: "Rechercher par photo",
    icon: Camera,
    to: "/catalogue/photo",
  },
  {
    id: "dossier",
    labelKey: "palette.dossier",
    labelDefault: "Exporter le dossier d'assurance",
    icon: FileText,
    to: "/insights/dossier",
  },
  {
    id: "gift",
    labelKey: "palette.gift",
    labelDefault: "Partager ma liste cadeau",
    icon: Gift,
    to: "/collection/souhaits",
  },
  {
    id: "search",
    labelKey: "palette.search",
    labelDefault: "Rechercher dans le catalogue",
    icon: Search,
    to: "/catalogue",
  },
];

/**
 * Old → new URL redirects (the IA moved). Kept indefinitely (bookmarks + PWA
 * installs persist). App.jsx renders each as a <Route> → <Navigate replace>.
 * `:param` segments are preserved by the Redirect helper.
 */
export const REDIRECTS = [
  { from: "/vitrines", to: "/collection/vitrines" },
  { from: "/souhaits", to: "/collection/souhaits" },
  { from: "/souhaits/import", to: "/collection/souhaits/import" },
  { from: "/preorders", to: "/collection/preorders" },
  { from: "/browse", to: "/catalogue" },
  { from: "/recognize", to: "/catalogue/photo" },
  { from: "/manufacturers/:slug", to: "/catalogue/manufacturers/:slug" },
  { from: "/series/:slug", to: "/catalogue/series/:slug" },
  { from: "/characters/:slug", to: "/catalogue/characters/:slug" },
  { from: "/stores/:slug", to: "/catalogue/stores/:slug" },
  { from: "/stats", to: "/insights" },
  { from: "/cote", to: "/insights/cote" },
  { from: "/year-in-review/:year", to: "/insights/year/:year" },
  { from: "/year-in-review", to: "/insights/year" },
  { from: "/collectionneurs", to: "/community" },
  { from: "/activity", to: "/community/activity" },
  { from: "/croisements", to: "/community/croisements" },
  { from: "/compare/:slug", to: "/u/:slug/compare" },
];

/** The section that "owns" a pathname (for active state + contextual sub-nav). */
export function sectionForPath(pathname) {
  return (
    SECTIONS.find(
      (s) =>
        pathname === s.to ||
        pathname.startsWith(`${s.to}/`) ||
        s.children?.some((c) => pathname === c.to || pathname.startsWith(`${c.to}/`)),
    ) ?? null
  );
}
