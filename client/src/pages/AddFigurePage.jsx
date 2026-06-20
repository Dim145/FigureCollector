import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Brush, ScanSearch, ScanLine } from "lucide-react";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useAddOwnedItem, useCreateFigure } from "../hooks/useCollection.js";
import AppShell from "../components/AppShell.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FigureForm from "../components/FigureForm.jsx";
import { Card, Checkbox } from "../components/ui/index.js";
import { PageLayout } from "../components/layout/index.js";
import { mapApiError } from "../lib/errorMap.js";

/**
 * /figures/new — add a piece to the catalogue, redrawn on the shared
 * foundation (Direction A "Shōjo-Noir").
 *
 * Thin orchestrator: data hooks + create/add-to-collection/NSFW-confirm logic,
 * then composition —
 *   <PageLayout> editorial header (kicker · 像 · CATALOGUE → AccentTitle)
 *   → a "Deux façons d'entrer" band (two WayCards) that keeps the hard product
 *     rule visible: manual entry is ALWAYS available, beside the external lookup
 *   → the <FigureForm> spine (the lookup + barcode entry points live inside it)
 *   → the "also add to my collection" choice as the form's footer extra.
 *
 * Behaviour unchanged: a no-match barcode scan lands here with ?jan=… (form
 * opens pre-filled with the scanned code); a no-match photo search lands with
 * ?name=….
 */
export default function AddFigurePage() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scannedJan = searchParams.get("jan");
  const prefillName = searchParams.get("name");
  const formInitial =
    scannedJan || prefillName
      ? {
          ...(scannedJan ? { jan: scannedJan } : {}),
          ...(prefillName ? { name: prefillName } : {}),
        }
      : undefined;
  const createFigure = useCreateFigure();
  const addOwned = useAddOwnedItem();
  const [alsoAddToCollection, setAlsoAddToCollection] = useState(true);
  // Payload waiting for an NSFW-warning acknowledgement (stays null in the happy
  // path). Replaces a window.confirm() whose UX clashed with the site's modals.
  const [pendingNsfwPayload, setPendingNsfwPayload] = useState(null);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const runSubmit = async (payload) => {
    try {
      const figure = await createFigure.mutateAsync(payload);
      if (alsoAddToCollection) {
        // Seed the owned-item's purchase price/currency from the catalog MSRP
        // just typed (overridable later). Empty MSRP → NULL price row.
        await addOwned.mutateAsync({
          figure_id: figure.id,
          price_amount: payload.msrp_amount,
          price_currency: payload.msrp_amount ? payload.msrp_currency : undefined,
          purchase_date: new Date().toISOString().slice(0, 10),
        });
      }
      navigate(alsoAddToCollection ? "/collection" : `/figures/${figure.id}`);
    } catch {
      /* surfaced via createFigure.error */
    }
  };

  const onSubmit = async (payload) => {
    // If the user tags NSFW while their own pref hides them, warn (don't block).
    const pref = me.data?.user?.nsfw_visibility ?? "hide";
    if (payload.is_nsfw && pref === "hide") {
      setPendingNsfwPayload(payload);
      return;
    }
    await runSubmit(payload);
  };

  const errorMessage = createFigure.error
    ? mapApiError(createFigure.error, t)
    : addOwned.error
      ? mapApiError(addOwned.error, t)
      : null;
  const isPending = createFigure.isPending || addOwned.isPending;

  return (
    <AppShell>
      <PageLayout
        width="prose"
        kanji="像"
        kicker={
          <span className="inline-flex items-center gap-2.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--primary)] rotate-45" />
            {t("addfig.kicker", { default: "AJOUTER" })}
            <span aria-hidden className="ja not-italic text-[var(--accent)]">
              像
            </span>
            {t("addfig.kicker_label", { default: "CATALOGUE" })}
          </span>
        }
        title={t("addfig.title")}
      >
        <p className="display-italic text-[var(--accent)] text-lg -mt-2 mb-8 max-w-xl">
          {t("addfig.gloss")}
        </p>

        {/* "Deux façons d'entrer" — the hard product rule, made visible. The
            actual lookup / scan controls live inside the form below; this band
            just orients the user so manual entry never reads as the lesser path. */}
        <section
          className="grid sm:grid-cols-2 gap-4 mb-8"
          aria-label={t("addfig.ways.heading", { default: "Deux façons d'ajouter" })}
        >
          <WayCard
            icon={Brush}
            title={t("addfig.ways.manual.title", { default: "Saisie manuelle" })}
            body={t("addfig.ways.manual.body", {
              default:
                "Remplissez la fiche vous-même. C'est toujours possible — chaque champ s'édite à la main.",
            })}
          />
          <WayCard
            icon={ScanSearch}
            accent
            title={t("addfig.ways.lookup.title", { default: "Recherche & scan" })}
            body={t("addfig.ways.lookup.body", {
              default:
                "Cherchez sur orzgk / les boutiques du proxy / AniList, collez un lien, ou scannez un code-barres — les champs trouvés se pré-remplissent. À retoucher ensuite.",
            })}
          />
        </section>

        {/* Scanned-barcode notice (only when arriving from a no-match scan). */}
        {scannedJan ? (
          <div
            className="mb-8 flex items-start gap-3 border-l-2 border-[var(--accent)] bg-[var(--accent)]/5 px-4 py-3"
            role="status"
          >
            <ScanLine size={20} className="text-[var(--accent)] shrink-0 mt-0.5" aria-hidden />
            <p className="text-sm text-[var(--on-surface-muted)] leading-relaxed">
              <span className="micro-tight block mb-1 text-[var(--color-or-pale)]">
                {t("scan.eyebrow")}
              </span>
              {t("addfig.scanned_jan", {
                jan: scannedJan,
                default:
                  "Code-barres scanné « {jan} » — pré-rempli ci-dessous. Complétez la fiche puis créez-la.",
              })}
            </p>
          </div>
        ) : null}

        {/* Form panel. */}
        <Card className="relative overflow-hidden p-6 md:p-8">
          <span aria-hidden className="kanji-mark text-[11rem] -top-10 -right-4 select-none">
            像
          </span>
          <header className="relative mb-6">
            <p className="micro flex items-center gap-2">
              <span
                className="ja not-italic text-base text-[var(--accent)] leading-none"
                aria-hidden
              >
                像
              </span>
              {t("addfig.form.eyebrow", { default: "Fiche catalogue" })}
            </p>
            <h2 className="display text-2xl md:text-3xl mt-2 text-[var(--on-surface)] leading-tight">
              {t("addfig.form.title", { default: "La fiche" })}
            </h2>
            <div className="gold-rule w-16 mt-4" />
          </header>

          <div className="relative">
            <FigureForm
              mode="create"
              initial={formInitial}
              onSubmit={onSubmit}
              busy={isPending}
              errorMessage={errorMessage}
              extras={
                <AlsoAddToggle
                  checked={alsoAddToCollection}
                  onChange={setAlsoAddToCollection}
                  disabled={isPending}
                  t={t}
                />
              }
            />
          </div>
        </Card>
      </PageLayout>

      <ConfirmDialog
        open={!!pendingNsfwPayload}
        title={t("nsfw.warn_on_create.title", { default: t("nsfw.warn_on_create") })}
        body={t("nsfw.warn_on_create")}
        busy={isPending}
        onCancel={() => setPendingNsfwPayload(null)}
        onConfirm={() => {
          const payload = pendingNsfwPayload;
          setPendingNsfwPayload(null);
          if (payload) runSubmit(payload);
        }}
      />
    </AppShell>
  );
}

/** One half of the "two ways in" band. The lookup side gets the hanko-red
 *  accent (the showier path); the manual side stays gold/quiet so it reads as
 *  the dependable default, never the afterthought. */
function WayCard({ icon: Icon, title, body, accent = false }) {
  return (
    <Card
      elevation={1}
      className="p-5 flex items-start gap-3.5"
      style={accent ? { borderColor: "var(--border-strong)" } : undefined}
    >
      <Icon
        size={22}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0"
        style={{ color: accent ? "var(--primary)" : "var(--accent)" }}
        aria-hidden
      />
      <div className="min-w-0">
        <h3 className="display text-lg text-[var(--on-surface)] leading-tight">{title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--on-surface-muted)]">{body}</p>
      </div>
    </Card>
  );
}

/** "Also add the freshly-created figure to my collection" — a bordered
 *  gold-accent control so the catalogue-vs-collection distinction is legible at
 *  submit time. Keeps the controlled-checkbox contract the page wires up. */
function AlsoAddToggle({ checked, onChange, disabled, t }) {
  return (
    <div
      className="p-4 border bg-[var(--surface-sunken)] transition-colors"
      style={{
        borderColor: checked ? "var(--border-strong)" : "var(--border-subtle)",
      }}
    >
      <Checkbox
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        label={t("addfig.also_add")}
        hint={t("addfig.also_add_hint", {
          default: "Décoché : la fiche rejoint le catalogue sans entrer dans votre vitrine.",
        })}
      />
    </div>
  );
}
