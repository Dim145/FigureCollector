import StatCard from "../../components/StatCard.jsx";

/**
 * Catalogue sub-header — the figurine-metrics KPI strip that sits directly
 * under the PageLayout editorial header. Pure presentation; every value is
 * derived in BrowsePage. Mirrors CollectionHeader's strip so the two paired
 * pages read alike.
 *
 *   Total catalogue · Owned (gold) · Wished (hanko-red) · Types
 */
export default function BrowseHeader({ t, total, ownedCount, wishedCount, typeCount }) {
  return (
    <div className="reveal" style={{ "--i": 0 }}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t("browse.title")} value={total} />
        <StatCard label={t("browse.kpi.owned")} value={ownedCount} tone="gold" />
        <StatCard label={t("wishlist.title")} value={wishedCount} tone="red" />
        <StatCard label={t("collection.kpi.types")} value={typeCount} />
      </div>
    </div>
  );
}
