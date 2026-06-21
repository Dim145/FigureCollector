import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useIsAdmin, useMe } from "../hooks/useMe.js";
import { useFigure, useOwnedItems } from "../hooks/useCollection.js";
import { useDeleteFigure } from "../hooks/useAdmin.js";
import { ApiError } from "../lib/api.js";
import { nsfwBlocked, nsfwClass } from "../lib/nsfw.js";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { preorderPhase, preorderPhaseFromFigure } from "../lib/preorderStatus.js";
import AppShell from "../components/AppShell.jsx";
import ErrorState from "../components/ErrorState.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FigureEditDialog from "../components/FigureEditDialog.jsx";
import ShareDialog from "../components/ShareDialog.jsx";
import BarcodeDialog from "../components/BarcodeDialog.jsx";
import Breadcrumbs from "../components/ui/Breadcrumbs.jsx";
import FigureHero from "../components/FigureHero.jsx";
import SummaryRail from "./figure-detail/SummaryRail.jsx";
import FigureAnchorIndex from "./figure-detail/FigureAnchorIndex.jsx";
import IdentitySection from "./figure-detail/IdentitySection.jsx";
import ValueSection from "./figure-detail/ValueSection.jsx";
import PreorderTimeline from "./figure-detail/PreorderTimeline.jsx";
import BoutiquesSection from "./figure-detail/BoutiquesSection.jsx";
import MaPieceSection from "./figure-detail/MaPieceSection.jsx";
import Turntable from "./figure-detail/Turntable.jsx";
import SimilarFiguresSection from "./figure-detail/SimilarFiguresSection.jsx";
import {
  FigureDetailLoading,
  FigureMissingState,
  NsfwInterstitial,
} from "./figure-detail/figureDetailStates.jsx";

/**
 * "La fiche d'une pièce" — the definitive single-object record page,
 * re-architected to the validated ⓪ La Fiche mockup. A thin orchestrator: it
 * resolves the figure + ownership, gates NSFW, owns the modal state, and
 * composes the page.
 *
 *   Breadcrumb (Catalogue › Fiche)
 *   HERO ROW   → FigureHero gallery (left, tall) + sticky SummaryRail (right)
 *   ANCHOR     → FigureAnchorIndex (scroll-spy kanji register)
 *   SECTIONS   → 目 #identite · 価 #valeur · 予 #preco · 店 #boutiques ·
 *                私 #ma-piece(=owner-stack) · 巡 #vue360 · 似 #proches
 *   Modals     → FigureEditDialog, delete ConfirmDialog, ShareDialog, BarcodeDialog
 *
 * Sections self-hide when their data is absent (no #preco unless preorder /
 * release date; no #ma-piece / #vue360 unless owned; #proches self-hides). The
 * anchor index only lists the sections actually rendered.
 */
export default function FigureDetailPage() {
  const { id } = useParams();
  const t = useT();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const figure = useFigure(id);
  // Include archived: this page must surface an archived owned_item too so the
  // user can restore it / see the cancellation history.
  const owned = useOwnedItems({ includeArchived: true });
  const del = useDeleteFigure();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [scanCode, setScanCode] = useState(false);
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState(false);

  // Live AppShell header height → `--fig-header-h`. The page has no contextual
  // sub-nav, so the real <header> is shorter than the 5rem the CSS hard-codes;
  // measuring it keeps the sticky anchor index (and rail) pinned EXACTLY under
  // the navbar across its scroll-shrink. rAF-coalesced; SSR-guarded.
  const rootRef = useRef(null);
  const figureReady = !!figure.data;
  useEffect(() => {
    if (typeof window === "undefined" || !figureReady) return undefined;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const h = document.querySelector("header")?.offsetHeight;
      if (h && rootRef.current) {
        rootRef.current.style.setProperty("--fig-header-h", `${h}px`);
      }
    };
    const onChange = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange, { passive: true });
    return () => {
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [figureReady]);

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
      // The mutation surfaces its own error via the global toast; resetting in
      // `finally` closes the confirm dialog either way.
    } finally {
      setConfirming(false);
    }
  };

  // Jump from the rail's "Éditer ma pièce" CTA down to the owner zone.
  const scrollToOwnerStack = () => {
    document.getElementById("owner-stack")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Which sections exist? The anchor index + content render in lockstep.
  const phase = ownedRecord ? preorderPhase(ownedRecord) : preorderPhaseFromFigure(f);
  const hasPreco =
    !!f.release_date || phase === "preorder" || phase === "imminent" || phase === "cancelled";
  const showValue = alreadyOwned;
  const showMine = alreadyOwned;
  const show360 = alreadyOwned;

  const anchors = [
    { id: "identite", kanji: "目", label: t("figure.anchor.identity", { default: "Identité" }) },
    showValue && {
      id: "valeur",
      kanji: "価",
      label: t("figure.anchor.value", { default: "Valeur" }),
    },
    hasPreco && {
      id: "preco",
      kanji: "予",
      label: t("figure.anchor.preorder", { default: "Pré-commande" }),
    },
    { id: "boutiques", kanji: "店", label: t("figure.anchor.shops", { default: "Boutiques" }) },
    showMine && {
      id: "owner-stack",
      kanji: "私",
      label: t("figure.anchor.mine", { default: "Ma pièce" }),
    },
    show360 && { id: "vue360", kanji: "巡", label: t("figure.anchor.view360", { default: "360°" }) },
    { id: "proches", kanji: "似", label: t("figure.anchor.similar", { default: "Proches" }) },
  ].filter(Boolean);

  return (
    <AppShell>
      <div ref={rootRef} className="fig-detail relative pb-24">
        {/* Breadcrumb — a quiet way back to the catalogue. */}
        <div className="max-w-7xl mx-auto px-6 pt-8">
          <Breadcrumbs
            items={[
              { label: t("figure.back", { default: "Catalogue" }), to: "/catalogue" },
              { label: t("figure.breadcrumb.current", { default: "Fiche" }) },
            ]}
          />
        </div>

        {/* ── HERO ROW ── gallery (left, tall) + sticky summary rail (right). No
         *  overflow:hidden on this subtree, or the sticky rail breaks. */}
        <section className="relative" style={{ "--hue": typeHue(f.figure_type) }}>
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 left-0 right-0 h-[460px] -z-0"
            style={{
              background:
                "radial-gradient(46% 70% at 22% 0%, color-mix(in oklab, var(--hue) 24%, transparent), transparent 68%), radial-gradient(40% 60% at 84% 12%, color-mix(in oklab, var(--color-or) 18%, transparent), transparent 72%)",
              maskImage: "linear-gradient(to bottom, transparent, #000 140px)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 140px)",
            }}
          />
          <span
            aria-hidden
            className="kanji-mark text-[32rem] -top-16 -left-16 hidden md:block opacity-[0.07]"
          >
            {typeKanji(f.figure_type)}
          </span>

          <div className="relative max-w-7xl mx-auto px-6 pt-12 md:pt-16 grid lg:grid-cols-[1.38fr_minmax(0,1fr)] gap-10 lg:gap-12 items-start">
            <FigureHero
              figure={f}
              ownedItemId={ownedRecord?.id ?? null}
              figureTypeKanji={typeKanji(f.figure_type)}
              nsfwBlurClass={nsfwClass(f.is_nsfw, nsfwPref)}
            />
            <SummaryRail
              f={f}
              ownedRecord={ownedRecord}
              alreadyOwned={alreadyOwned}
              canEdit={canEdit}
              t={t}
              onEdit={() => setEditing(true)}
              onDelete={() => setConfirming(true)}
              onShare={() => setSharing(true)}
              onEditMine={scrollToOwnerStack}
            />
          </div>
        </section>

        {/* ── STICKY ANCHOR INDEX ── */}
        <FigureAnchorIndex entries={anchors} />

        {/* ── SECTIONS ── single full-width editorial scroll. */}
        <div className="max-w-7xl mx-auto px-6">
          <Section id="identite" kanji="目" title={t("figure.anchor.identity", { default: "Identité" })}>
            <IdentitySection
              f={f}
              t={t}
              canEdit={canEdit}
              nsfwPref={nsfwPref}
              galleryDefaultOpen={!alreadyOwned}
            />
          </Section>

          {showValue ? (
            <Section
              id="valeur"
              kanji="価"
              title={t("figure.anchor.value", { default: "Valeur" })}
              meta={t("figure.value.meta", { default: "EUR · taux figé à l'achat" })}
            >
              <ValueSection f={f} owned={ownedRecord} t={t} />
            </Section>
          ) : null}

          {hasPreco ? (
            <Section
              id="preco"
              kanji="予"
              title={t("figure.anchor.preorder", { default: "Pré-commande" })}
              meta={t("figure.preco.meta", { default: "Acompte non-remboursable" })}
            >
              <PreorderTimeline f={f} owned={ownedRecord} t={t} />
            </Section>
          ) : null}

          <Section id="boutiques" kanji="店" title={t("figure.cartouche.stores")}>
            <BoutiquesSection f={f} t={t} onShowBarcode={() => setScanCode(true)} />
          </Section>

          {showMine ? (
            // Owner zone — genuine owner-copy data only (état / notes / photos /
            // cover / justificatifs). The catalogue gallery now lives in
            // #identite; the preorder history/tracking now lives in #preco.
            <Section
              id="owner-stack"
              kanji="私"
              title={t("figure.owner.title")}
              variant="mapiece"
              banner={t("figure.already_owned")}
            >
              <MaPieceSection f={f} owned={ownedRecord} nsfwPref={nsfwPref} t={t} />
            </Section>
          ) : null}

          {show360 ? (
            <Section
              id="vue360"
              kanji="巡"
              title={t("figure.anchor.view360", { default: "Vue 360°" })}
              meta={t("figure.view360.meta", { default: "turntable · maintenez et glissez" })}
            >
              <Turntable owned={ownedRecord} />
            </Section>
          ) : null}
        </div>

        {/* Figurines visuellement proches — self-hides (renders null when photo
         *  search is off or there are no neighbours). It brings its own
         *  max-width + centred heading chrome, so it sits OUTSIDE the shared
         *  section container; the `#proches` anchor lands on this wrapper. */}
        <div id="proches" style={{ scrollMarginTop: "calc(var(--fig-header-h, 5rem) + 4rem)" }}>
          <SimilarFiguresSection figureId={f.id} nsfwPref={nsfwPref} t={t} />
        </div>

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

/** A titled content section — kanji + gold-rule head + an `id` that matches an
 *  anchor entry. The `mapiece` variant wraps the body in the visually-distinct
 *  owner zone (border + watermark + banner). */
function Section({ id, kanji, title, meta, banner, variant, children }) {
  return (
    <section id={id} className={`fig-section ${variant === "mapiece" ? "fig-mapiece" : ""}`}>
      {variant === "mapiece" ? (
        <div className="fig-mapiece-banner">
          <span className="seal ja" aria-hidden>
            私
          </span>
          <span className="fig-mapiece-banner-title">
            <span className="em">{title}</span>
            {banner ? <span className="fig-mapiece-banner-sub"> · {banner}</span> : null}
          </span>
        </div>
      ) : (
        <header className="fig-section-head">
          <span className="ja" aria-hidden>
            {kanji}
          </span>
          <h2>{title}</h2>
          {meta ? <span className="meta">{meta}</span> : null}
        </header>
      )}
      {children}
    </section>
  );
}
