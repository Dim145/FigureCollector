import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { REDIRECTS } from "./lib/navConfig.js";

// ─── Route-level code splitting ──────────────────────────────────────────────
//
// Each page is its own chunk so the initial bundle ships only the shell + the
// router. The top-level components mounted *outside* <Routes> (CommandPalette,
// LiveSyncProvider, ToastProvider, etc.) stay eager — persistent UI needed on
// every page.
const LandingPage = lazy(() => import("./pages/LandingPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const RegisterPage = lazy(() => import("./pages/RegisterPage.jsx"));
const CollectionPage = lazy(() => import("./pages/CollectionPage.jsx"));
const CotePage = lazy(() => import("./pages/CotePage.jsx"));
const VitrinesPage = lazy(() => import("./pages/VitrinesPage.jsx"));
const WishlistPage = lazy(() => import("./pages/WishlistPage.jsx"));
const WishlistImportPage = lazy(() => import("./pages/WishlistImportPage.jsx"));
const SharedWishlistPage = lazy(() => import("./pages/SharedWishlistPage.jsx"));
const AddFigurePage = lazy(() => import("./pages/AddFigurePage.jsx"));
const FigureDetailPage = lazy(() => import("./pages/FigureDetailPage.jsx"));
const PreordersPage = lazy(() => import("./pages/PreordersPage.jsx"));
const BrowsePage = lazy(() => import("./pages/BrowsePage.jsx"));
const PublicProfilePage = lazy(() => import("./pages/PublicProfilePage.jsx"));
const DiscoverPage = lazy(() => import("./pages/DiscoverPage.jsx"));
const CroisementsPage = lazy(() => import("./pages/CroisementsPage.jsx"));
const ComparePage = lazy(() => import("./pages/ComparePage.jsx"));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx"));
const ActivityPage = lazy(() => import("./pages/ActivityPage.jsx"));
const YearInReviewPage = lazy(() => import("./pages/YearInReviewPage.jsx"));
const AchievementsPage = lazy(() => import("./pages/AchievementsPage.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const StatsPage = lazy(() => import("./pages/StatsPage.jsx"));
const DossierPage = lazy(() => import("./pages/insights/DossierPage.jsx"));
const EntityPage = lazy(() => import("./pages/EntityPage.jsx"));
const AdminLayout = lazy(() => import("./pages/AdminLayout.jsx"));
const AdminOverviewPage = lazy(() => import("./pages/AdminOverviewPage.jsx"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage.jsx"));
const AdminFiguresPage = lazy(() => import("./pages/AdminFiguresPage.jsx"));
const AdminCatalogPage = lazy(() => import("./pages/AdminCatalogPage.jsx"));
const AdminFigureTypesPage = lazy(() => import("./pages/AdminFigureTypesPage.jsx"));
const AdminStoresPage = lazy(() => import("./pages/AdminStoresPage.jsx"));
const AdminNotificationsPage = lazy(() => import("./pages/AdminNotificationsPage.jsx"));
const AdminMangaServersPage = lazy(() => import("./pages/AdminMangaServersPage.jsx"));
const AdminWorkersPage = lazy(() => import("./pages/AdminWorkersPage.jsx"));
const RecognizePage = lazy(() => import("./pages/RecognizePage.jsx"));
const AdminTasksPage = lazy(() => import("./pages/AdminTasksPage.jsx"));
const AdminSettingsPage = lazy(() => import("./pages/AdminSettingsPage.jsx"));
const StorePage = lazy(() => import("./pages/StorePage.jsx"));

import CommandPalette from "./components/CommandPalette.jsx";
import LiveSyncProvider from "./components/LiveSyncProvider.jsx";
import OfflineIndicator from "./components/OfflineIndicator.jsx";
import UpdateToast from "./components/UpdateToast.jsx";
import GChordProvider from "./components/GChordProvider.jsx";
import AchievementCeremony from "./components/AchievementCeremony.jsx";
import { ToastProvider } from "./components/ui/Toast.jsx";

/**
 * Minimal Suspense fallback — a faint watermark glyph rather than a spinner;
 * deliberately tiny so it doesn't pop on cached-chunk-instant transitions.
 */
function PageFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "var(--color-noir, #0a0807)",
        color: "var(--color-or-pale, rgba(214,178,113,0.6))",
        fontFamily: "var(--font-display, serif)",
        fontSize: "1.05rem",
        letterSpacing: "0.2em",
      }}
    >
      ◇
    </div>
  );
}

/**
 * Param- and query-preserving redirect for the IA's old→new URL moves.
 * `<Redirect to="/catalogue/series/:slug" />` substitutes :slug from the
 * matched route and carries over ?search and #hash.
 */
function Redirect({ to }) {
  const params = useParams();
  const loc = useLocation();
  const pathname = to.replace(/:([A-Za-z0-9_]+)/g, (_, key) => params[key] ?? "");
  return <Navigate to={{ pathname, search: loc.search, hash: loc.hash }} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <LiveSyncProvider>
        <ToastProvider>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              {/* ── Public ── */}
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              {/* Anonymous gift list — must render without a session/redirect */}
              <Route path="/g/:token" element={<SharedWishlistPage />} />

              {/* ── 蒐 Collection ── */}
              <Route path="/collection" element={<CollectionPage />} />
              <Route path="/collection/vitrines" element={<VitrinesPage />} />
              <Route path="/collection/souhaits" element={<WishlistPage />} />
              <Route path="/collection/souhaits/import" element={<WishlistImportPage />} />
              <Route path="/collection/preorders" element={<PreordersPage />} />

              {/* ── 目 Catalogue ── */}
              <Route path="/catalogue" element={<BrowsePage />} />
              <Route path="/catalogue/photo" element={<RecognizePage />} />
              <Route
                path="/catalogue/manufacturers/:slug"
                element={<EntityPage kind="manufacturer" />}
              />
              <Route path="/catalogue/series/:slug" element={<EntityPage kind="series" />} />
              <Route path="/catalogue/characters/:slug" element={<EntityPage kind="character" />} />
              <Route path="/catalogue/stores/:slug" element={<StorePage />} />
              <Route path="/figures/new" element={<AddFigurePage />} />
              <Route path="/figures/:id" element={<FigureDetailPage />} />

              {/* ── 析 Insights ── */}
              <Route path="/insights" element={<StatsPage />} />
              <Route path="/insights/cote" element={<CotePage />} />
              <Route path="/insights/year/:year" element={<YearInReviewPage />} />
              <Route path="/insights/year" element={<YearInReviewPage />} />
              <Route path="/insights/dossier" element={<DossierPage />} />

              {/* ── 縁 Communauté ── */}
              <Route path="/community" element={<DiscoverPage />} />
              <Route path="/community/activity" element={<ActivityPage />} />
              <Route path="/community/croisements" element={<CroisementsPage />} />
              <Route path="/u/:slug" element={<PublicProfilePage />} />
              <Route path="/u/:slug/compare" element={<ComparePage />} />

              {/* ── Account ── */}
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/achievements" element={<AchievementsPage />} />

              {/* ── Admin ── */}
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverviewPage />} />
                <Route path="users" element={<AdminUsersPage />} />
                <Route path="figures" element={<AdminFiguresPage />} />
                <Route path="catalog" element={<AdminCatalogPage />} />
                <Route path="figure-types" element={<AdminFigureTypesPage />} />
                <Route path="stores" element={<AdminStoresPage />} />
                <Route path="manga-servers" element={<AdminMangaServersPage />} />
                <Route path="notifications" element={<AdminNotificationsPage />} />
                <Route path="workers" element={<AdminWorkersPage />} />
                <Route path="tasks" element={<AdminTasksPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
              </Route>

              {/* ── Redirects (old IA → new IA; params + query preserved) ── */}
              {REDIRECTS.map((r) => (
                <Route key={r.from} path={r.from} element={<Redirect to={r.to} />} />
              ))}

              <Route path="*" element={<LandingPage />} />
            </Routes>
          </Suspense>
          <CommandPalette />
          <OfflineIndicator />
          <UpdateToast />
          <GChordProvider />
          <AchievementCeremony />
        </ToastProvider>
      </LiveSyncProvider>
    </BrowserRouter>
  );
}
