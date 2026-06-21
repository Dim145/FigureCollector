import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigure, useOwnedItems } from "../hooks/useCollection.js";
import { useDeleteFigure } from "../hooks/useAdmin.js";
import { ApiError } from "../lib/api.js";
import { nsfwBlocked } from "../lib/nsfw.js";
import AppShell from "../components/AppShell.jsx";
import ErrorState from "../components/ErrorState.jsx";
import Foldable from "../components/Foldable.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import FigurePhotosSection from "../components/FigurePhotosSection.jsx";
import ShareDialog from "../components/ShareDialog.jsx";
import BarcodeDialog from "../components/BarcodeDialog.jsx";
import Breadcrumbs from "../components/ui/Breadcrumbs.jsx";
import FigureHeroPanel from "./figure-detail/FigureHeroPanel.jsx";
import FigureCartouche from "./figure-detail/FigureCartouche.jsx";
import OwnerStack from "./figure-detail/OwnerStack.jsx";
import SimilarFiguresSection from "./figure-detail/SimilarFiguresSection.jsx";
import {
  FigureDetailLoading,
  FigureMissingState,
  NsfwInterstitial,
} from "./figure-detail/figureDetailStates.jsx";

/**
 * "La fiche d'une pièce" — the definitive single-object record page. A thin
 * orchestrator: it resolves the figure + ownership, gates NSFW, owns the
 * modal/overlay state, and composes the page-local panels. No tabs — a long
 * editorial scroll (mobile-friendly):
 *
 *   Breadcrumbs (CATALOGUE › Fiche)
 *   I.   Hero          → FigureHeroPanel (gallery + headline + glance + CTA)
 *   II.  La fiche       → <Foldable> FigureCartouche + FigurePhotosSection
 *                         (open by default when the viewer doesn't own it)
 *   III. Ma pièce       → OwnerStack (owner-only: editor, cover, preorder,
 *                         photos, justificatifs, 360°)
 *   IV.  Figures proches → SimilarFiguresSection (DINOv2; self-hides)
 *
 * Modals (FigureEditDialog, delete ConfirmDialog, ShareDialog, BarcodeDialog)
 * are mounted here so a single piece of state drives each.
 */
export default function FigureDetailPage() {
  const { id } = useParams();
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const figure = useFigure(id);
  // Include archived: this page must surface an archived owned_item too so the
  // user can restore it / see the cancellation history. /collection filters
  // them out via its own toggle.
  const owned = useOwnedItems({ includeArchived: true });
  const del = useDeleteFigure();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [scanCode, setScanCode] = useState(false);
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState(false);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;
  if (figure.isLoading)
    return (
      <AppShell>
        <FigureDetailLoading />
      </AppShell>
    );
  if (figure.isError) {
    const notFound = figure.error instanceof ApiError && figure.error.status === 404;
    return (
      <AppShell>
        {notFound ? (
          <FigureMissingState t={t} figureId={id} />
        ) : (
          <ErrorState error={figure.error} onRetry={() => figure.refetch()} />
        )}
      </AppShell>
    );
  }
  if (!figure.data)
    return (
      <AppShell>
        <FigureDetailLoading />
      </AppShell>
    );

  const f = figure.data;
  const ownedRecord = owned.data?.find((o) => o.figure_id === f.id);
  const alreadyOwned = !!ownedRecord;
  const canEdit = isAdmin || f.created_by === me.data?.user?.id;
  const nsfwPref = me.data?.user?.nsfw_visibility ?? "hide";

  if (nsfwBlocked(f.is_nsfw, nsfwPref) && !isAdmin && !nsfwAcknowledged) {
    return (
      <AppShell>
        <NsfwInterstitial t={t} figureId={f.id} onAcknowledge={() => setNsfwAcknowledged(true)} />
      </AppShell>
    );
  }

  const onDelete = async () => {
    try {
      await del.mutateAsync(f.id);
      navigate("/catalogue");
    } catch {
      // The mutation surfaces its own error via the global toast; we only need
      // to make sure a failed delete doesn't leave the confirm dialog stuck
      // open + disabled. Resetting in `finally` closes it either way.
    } finally {
      setConfirming(false);
    }
  };

  // Jump from the hero's "Éditer ma pièce" CTA down to the owner editor.
  const scrollToOwnerStack = () => {
    document.getElementById("owner-stack")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <AppShell>
      <div className="relative pb-24">
        {/* Editorial breadcrumb — CATALOGUE › Fiche, a quiet way back to where
         *  most arrivals come from. */}
        <div className="max-w-7xl mx-auto px-6 pt-8">
          <Breadcrumbs
            items={[
              { label: t("figure.back", { default: "Catalogue" }), to: "/catalogue" },
              { label: t("figure.breadcrumb.current", { default: "Fiche" }) },
            ]}
          />
        </div>

        <FigureHeroPanel
          f={f}
          ownedRecord={ownedRecord}
          alreadyOwned={alreadyOwned}
          canEdit={canEdit}
          nsfwPref={nsfwPref}
          t={t}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirming(true)}
          onShare={() => setSharing(true)}
          onEditMine={scrollToOwnerStack}
        />

        {/* "La fiche" — catalog data + shared gallery, in one foldable. Defaults
         *  OPEN when the viewer doesn't own the piece (they need everything to
         *  decide); CLOSED when they do (their own data is the focus then). */}
        <section className="max-w-7xl mx-auto px-6">
          <Foldable size="major" label={t("figure.section.cartouche")} defaultOpen={!alreadyOwned}>
            <FigureCartouche f={f} t={t} onShowBarcode={() => setScanCode(true)} />
            <div className="mt-12">
              <FigurePhotosSection
                figureId={f.id}
                figureName={f.name}
                canEdit={canEdit}
                uploadDisabled={f.is_nsfw && nsfwPref === "blur"}
                blurImages={f.is_nsfw && nsfwPref === "blur"}
              />
            </div>
          </Foldable>
        </section>

        {/* Owner-only stack — each block independently foldable. */}
        {ownedRecord ? <OwnerStack f={f} owned={ownedRecord} nsfwPref={nsfwPref} t={t} /> : null}

        {/* Figurines visuellement proches — self-hides when photo search is off
         *  or the piece isn't on the index yet. */}
        <SimilarFiguresSection figureId={f.id} nsfwPref={nsfwPref} t={t} />

        {/* ─── Modals + fullscreen overlays ─── */}
        {editing ? <FigureEditDialog figure={f} onClose={() => setEditing(false)} /> : null}

        <ConfirmDialog
          open={confirming}
          title={t("figure.edit.confirm_delete.title", { name: f.name })}
          body={t("figure.edit.confirm_delete.body")}
          confirmLabel={t("admin.users.confirm_delete.confirm")}
          destructive
          busy={del.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={onDelete}
        />

        {sharing ? (
          <ShareDialog
            url={typeof window !== "undefined" ? window.location.href : ""}
            title={f.name}
            onClose={() => setSharing(false)}
          />
        ) : null}

        {scanCode && f.jan ? (
          <BarcodeDialog code={f.jan} label={f.name} onClose={() => setScanCode(false)} />
        ) : null}
      </div>
    </AppShell>
  );
}
