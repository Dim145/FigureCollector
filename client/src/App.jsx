import { BrowserRouter, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import CollectionPage from "./pages/CollectionPage.jsx";
import AddFigurePage from "./pages/AddFigurePage.jsx";
import FigureDetailPage from "./pages/FigureDetailPage.jsx";
import PreordersPage from "./pages/PreordersPage.jsx";
import BrowsePage from "./pages/BrowsePage.jsx";
import PublicProfilePage from "./pages/PublicProfilePage.jsx";
import ComparePage from "./pages/ComparePage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import ActivityPage from "./pages/ActivityPage.jsx";
import YearInReviewPage from "./pages/YearInReviewPage.jsx";
import AchievementsPage from "./pages/AchievementsPage.jsx";
import NotificationsPage from "./pages/NotificationsPage.jsx";
import StatsPage from "./pages/StatsPage.jsx";
import EntityPage from "./pages/EntityPage.jsx";
import AdminLayout from "./pages/AdminLayout.jsx";
import AdminOverviewPage from "./pages/AdminOverviewPage.jsx";
import AdminUsersPage from "./pages/AdminUsersPage.jsx";
import AdminFiguresPage from "./pages/AdminFiguresPage.jsx";
import AdminCatalogPage from "./pages/AdminCatalogPage.jsx";
import AdminNotificationsPage from "./pages/AdminNotificationsPage.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import LiveSyncProvider from "./components/LiveSyncProvider.jsx";
import OfflineIndicator from "./components/OfflineIndicator.jsx";
import UpdateToast from "./components/UpdateToast.jsx";
import GChordProvider from "./components/GChordProvider.jsx";
import AchievementCeremony from "./components/AchievementCeremony.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <LiveSyncProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/collection" element={<CollectionPage />} />
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
            <Route path="notifications" element={<AdminNotificationsPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/u/:slug" element={<PublicProfilePage />} />
          <Route path="/compare/:slug" element={<ComparePage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
        <CommandPalette />
        <OfflineIndicator />
        <UpdateToast />
        <GChordProvider />
        <AchievementCeremony />
      </LiveSyncProvider>
    </BrowserRouter>
  );
}
