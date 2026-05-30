import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

// ─── Route-level code splitting ──────────────────────────────────────────────
//
// Each page is its own chunk so the initial bundle ships only the shell + the
// router. Previously the main bundle was 419 KB / 130 KB gzipped because
// LoginPage dragged in AdminCatalogPage, YearInReview, and a pile of dialogs
// that 90 % of visitors never open. With lazy() the user only downloads the
// chunk for the route they land on; the rest stream in on demand.
//
// The top-level components mounted *outside* <Routes> (CommandPalette,
// LiveSyncProvider, etc.) stay eager — they're persistent UI that's needed
// on every page anyway.
const LandingPage          = lazy(() => import("./pages/LandingPage.jsx"));
const LoginPage            = lazy(() => import("./pages/LoginPage.jsx"));
const RegisterPage         = lazy(() => import("./pages/RegisterPage.jsx"));
const CollectionPage       = lazy(() => import("./pages/CollectionPage.jsx"));
const CotePage             = lazy(() => import("./pages/CotePage.jsx"));
const VitrinesPage         = lazy(() => import("./pages/VitrinesPage.jsx"));
const WishlistPage         = lazy(() => import("./pages/WishlistPage.jsx"));
const AddFigurePage        = lazy(() => import("./pages/AddFigurePage.jsx"));
const FigureDetailPage     = lazy(() => import("./pages/FigureDetailPage.jsx"));
const PreordersPage        = lazy(() => import("./pages/PreordersPage.jsx"));
const BrowsePage           = lazy(() => import("./pages/BrowsePage.jsx"));
const PublicProfilePage    = lazy(() => import("./pages/PublicProfilePage.jsx"));
const DiscoverPage         = lazy(() => import("./pages/DiscoverPage.jsx"));
const ComparePage          = lazy(() => import("./pages/ComparePage.jsx"));
const SettingsPage         = lazy(() => import("./pages/SettingsPage.jsx"));
const ActivityPage         = lazy(() => import("./pages/ActivityPage.jsx"));
const YearInReviewPage     = lazy(() => import("./pages/YearInReviewPage.jsx"));
const AchievementsPage     = lazy(() => import("./pages/AchievementsPage.jsx"));
const NotificationsPage    = lazy(() => import("./pages/NotificationsPage.jsx"));
const StatsPage            = lazy(() => import("./pages/StatsPage.jsx"));
const EntityPage           = lazy(() => import("./pages/EntityPage.jsx"));
const AdminLayout          = lazy(() => import("./pages/AdminLayout.jsx"));
const AdminOverviewPage    = lazy(() => import("./pages/AdminOverviewPage.jsx"));
const AdminUsersPage       = lazy(() => import("./pages/AdminUsersPage.jsx"));
const AdminFiguresPage     = lazy(() => import("./pages/AdminFiguresPage.jsx"));
const AdminCatalogPage     = lazy(() => import("./pages/AdminCatalogPage.jsx"));
const AdminFigureTypesPage = lazy(() => import("./pages/AdminFigureTypesPage.jsx"));
const AdminStoresPage      = lazy(() => import("./pages/AdminStoresPage.jsx"));
const AdminNotificationsPage = lazy(() => import("./pages/AdminNotificationsPage.jsx"));
const AdminWorkersPage     = lazy(() => import("./pages/AdminWorkersPage.jsx"));
const StorePage            = lazy(() => import("./pages/StorePage.jsx"));

import CommandPalette from "./components/CommandPalette.jsx";
import LiveSyncProvider from "./components/LiveSyncProvider.jsx";
import OfflineIndicator from "./components/OfflineIndicator.jsx";
import UpdateToast from "./components/UpdateToast.jsx";
import GChordProvider from "./components/GChordProvider.jsx";
import AchievementCeremony from "./components/AchievementCeremony.jsx";

/**
 * Minimal Suspense fallback. The editorial dark theme means a faint
 * watermark feels better than a generic spinner; deliberately tiny so it
 * doesn't pop on cached-chunk-instant transitions.
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

export default function App() {
  return (
    <BrowserRouter>
      <LiveSyncProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/collection" element={<CollectionPage />} />
            <Route path="/cote" element={<CotePage />} />
            <Route path="/vitrines" element={<VitrinesPage />} />
            <Route path="/souhaits" element={<WishlistPage />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/figures/new" element={<AddFigurePage />} />
            <Route path="/figures/:id" element={<FigureDetailPage />} />
            <Route
              path="/manufacturers/:slug"
              element={<EntityPage kind="manufacturer" />}
            />
            <Route path="/series/:slug" element={<EntityPage kind="series" />} />
            <Route
              path="/characters/:slug"
              element={<EntityPage kind="character" />}
            />
            <Route path="/stores/:slug" element={<StorePage />} />
            <Route path="/preorders" element={<PreordersPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/year-in-review/:year" element={<YearInReviewPage />} />
            <Route path="/year-in-review" element={<YearInReviewPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/achievements" element={<AchievementsPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="figures" element={<AdminFiguresPage />} />
              <Route path="catalog" element={<AdminCatalogPage />} />
              <Route path="figure-types" element={<AdminFigureTypesPage />} />
              <Route path="stores" element={<AdminStoresPage />} />
              <Route path="notifications" element={<AdminNotificationsPage />} />
              <Route path="workers" element={<AdminWorkersPage />} />
            </Route>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/collectionneurs" element={<DiscoverPage />} />
            <Route path="/u/:slug" element={<PublicProfilePage />} />
            <Route path="/compare/:slug" element={<ComparePage />} />
            <Route path="*" element={<LandingPage />} />
          </Routes>
        </Suspense>
        <CommandPalette />
        <OfflineIndicator />
        <UpdateToast />
        <GChordProvider />
        <AchievementCeremony />
      </LiveSyncProvider>
    </BrowserRouter>
  );
}
