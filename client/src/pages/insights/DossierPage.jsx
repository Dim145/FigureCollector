import AppShell from "../../components/AppShell.jsx";
import { PageLayout } from "../../components/layout/index.js";
import { EmptyState } from "../../components/ui/index.js";
import { useT } from "../../i18n/index.jsx";
import { useMyStats } from "../../hooks/useStats.js";
import { useOwnedItems } from "../../hooks/useCollection.js";
import { useMe } from "../../hooks/useMe.js";
import DossierExportButton from "../../components/DossierExportButton.jsx";
import CoveragePanel from "./CoveragePanel.jsx";

/**
 * 保 Dossier d'assurance — the insurance export surfaced as its own Insights
 * page (also reachable from Settings › Archives). Wraps the shared
 * DossierExportButton with context; the data plumbing mirrors ArchivesPanel.
 */
export default function DossierPage() {
  const t = useT();
  const stats = useMyStats();
  const owned = useOwnedItems();
  const me = useMe();
  const hasOwned = !!owned.data?.length;

  return (
    <AppShell>
      <PageLayout
        kicker={t("insights.dossier.kicker", { default: "ANALYSES · 保 · DOSSIER" })}
        title={t("insights.dossier.title", { default: "Dossier d'assurance" })}
        kanji="保"
        breadcrumbs={[
          { label: t("nav.insights", { default: "Analyses" }), to: "/insights" },
          { label: t("insights.dossier.title", { default: "Dossier d'assurance" }) },
        ]}
        width="prose"
      >
        <p className="text-[var(--on-surface-muted)] leading-relaxed mb-6 max-w-prose">
          {t("insights.dossier.body", {
            default:
              "Génère un PDF unique réunissant l'inventaire daté de ta collection et les justificatifs (factures) de chaque pièce — prêt à transmettre à ton assurance.",
          })}
        </p>
        {hasOwned ? <CoveragePanel owned={owned.data} t={t} /> : null}

        {hasOwned ? (
          <div
            className="bg-[var(--surface)] border border-[var(--border)] p-6"
            style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--elevation-2)" }}
          >
            <DossierExportButton
              owned={owned.data}
              stats={stats.data}
              ownerName={me.data?.user?.display_name}
            />
          </div>
        ) : (
          <EmptyState
            kanji="保"
            eyebrow={t("nav.insights", { default: "Analyses" })}
            title={t("insights.dossier.empty", { default: "Aucune pièce à assurer" })}
            body={t("insights.dossier.empty_body", {
              default: "Ajoute des pièces à ta collection pour générer un dossier.",
            })}
          />
        )}
      </PageLayout>
    </AppShell>
  );
}
