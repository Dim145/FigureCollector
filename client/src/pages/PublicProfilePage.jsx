import { Link, Navigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { usePublicProfile } from "../hooks/useProfile.js";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Button from "../components/Button.jsx";

export default function PublicProfilePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const profile = usePublicProfile(slug);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  if (profile.isLoading) return <AppShell><Loading /></AppShell>;
  if (profile.error || !profile.data)
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <p className="display text-2xl text-[var(--color-ivoire)]">404</p>
          <p className="mt-2 text-[var(--color-ivoire-soft)]">{t("profile.private")}</p>
        </main>
      </AppShell>
    );

  const { user, stats, collection } = profile.data;
  const isSelf = me.data?.user?.username === user.username;

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="text-center mb-12">
          <p className="micro">
            {t("profile.member_since", { date: new Date(user.member_since).toLocaleDateString() })}
          </p>
          <h1 className="display text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("profile.public_title", { name: user.display_name })}
          </h1>
          <p className="ja text-base mt-2 text-[var(--color-or-pale)] tracking-[0.3em]">
            @{user.username}
          </p>
          <div className="gold-rule mx-auto w-32 mt-6" />

          <dl className="mt-8 flex justify-center gap-12">
            <Stat label={t("profile.stat_pieces")} value={stats.pieces} />
            <Stat label={t("profile.stat_series")} value={stats.series_count} />
            <Stat label={t("profile.stat_manufacturers")} value={stats.manufacturers_count} />
          </dl>

          {!isSelf ? (
            <div className="mt-8 flex justify-center gap-3">
              <Link to={`/compare/${user.username}`}>
                <Button variant="ghost">{t("compare.title", { name: user.display_name })}</Button>
              </Link>
            </div>
          ) : null}
        </header>

        {collection.length === 0 ? (
          <p className="text-center text-[var(--color-ivoire-soft)] py-12">
            {t("collection.empty.title")}
          </p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {collection.map((entry) => (
              <li key={entry.owned_id}>
                <FigureCard
                  figureId={entry.figure_id}
                  href={`/figures/${entry.figure_id}`}
                  name={entry.figure_name}
                  type={entry.figure_type}
                  manufacturer={entry.manufacturer_name}
                  imageUrl={entry.figure_image}
                  scale={entry.scale}
                  versionName={entry.version_name}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <p className="display text-4xl text-[var(--color-or)]">{value}</p>
      <p className="micro mt-1">{label}</p>
    </div>
  );
}

function Loading() {
  return <main className="max-w-md mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)]">…</main>;
}
