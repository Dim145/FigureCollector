import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useAddOwnedItem, useCreateFigure } from "../hooks/useCollection.js";
import AccentTitle from "../components/AccentTitle.jsx";
import AppShell from "../components/AppShell.jsx";
import Card from "../components/Card.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import FigureForm from "../components/FigureForm.jsx";
import { mapApiError } from "../lib/errorMap.js";

/**
 * /figures/new — "Le bordereau d'entrée", redrawn to Direction A ("Shōjo-Noir").
 *
 * Adding a piece to the catalogue, reframed as an editorial accession slip
 * rather than a bare form-in-a-box:
 *   - an editorial header (kicker · 像 · CATALOGUE → AccentTitle h1 → gold-rule
 *     → italic gloss) over a faint kanji-mark watermark;
 *   - a "two ways in" band that makes the hard product rule visible — manual
 *     entry is *always* available, side-by-side with the external lookup
 *     (orzgk + the proxy's boutiques, plus MFC paste-import) and barcode-scan
 *     entry points that live inside the form itself;
 *   - the form wrapped in a clearly-sectioned Card panel (kicker sub-label +
 *     kanji + gold-rule divider, like SettingsPage), with the "also add to my
 *     collection" choice promoted into a refined gold-accent control;
 *   - a quiet seigaiha wave veil closing the page.
 *
 * Behaviour is unchanged: a barcode scan that found no catalogue match still
 * lands here with `?jan=…` so the form opens pre-filled with the scanned code;
 * all create / add-to-collection / NSFW-confirm logic lives below untouched.
 * GPU-light throughout — flat fills + hairlines + the shared `.reveal` stagger.
 */
export default function AddFigurePage() {
  const t = useT();
  const me = useMe();
  const navigate = useNavigate();
  // A barcode scan that found no catalogue match lands here with ?jan=… so the
  // form opens pre-filled with the scanned barcode.
  const [searchParams] = useSearchParams();
  const scannedJan = searchParams.get("jan");
  const createFigure = useCreateFigure();
  const addOwned = useAddOwnedItem();
  const [alsoAddToCollection, setAlsoAddToCollection] = useState(true);
  // Payload waiting for an NSFW-warning acknowledgement. Stays null in the
  // happy path. Replaces a `window.confirm()` whose UX clashed with the
  // rest of the site's modal style.
  const [pendingNsfwPayload, setPendingNsfwPayload] = useState(null);

  if (me.isLoading) return null;
  if (!me.data?.authenticated) return <Navigate to="/login" replace />;

  const runSubmit = async (payload) => {
    try {
      const figure = await createFigure.mutateAsync(payload);
      if (alsoAddToCollection) {
        // When the user is also adding the freshly-created figure to their
        // collection, seed the owned-item's purchase price + currency from
        // the catalog MSRP they just typed. They can override later via the
        // owned-item editor on the figure detail page. Empty MSRP =
        // payload.msrp_amount undefined → owned row created with NULL price.
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
    // If the user tags a figure as NSFW while their own pref hides them,
    // warn (but don't block) — they may want to set the pref to "blur" or
    // "show" before they continue, or they might be content uploading for
    // others without seeing it themselves.
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
      <main className="relative max-w-3xl mx-auto px-6 py-16">
        {/* ─── Editorial header ─── */}
        <header className="relative mb-10">
          <span
            aria-hidden
            className="kanji-mark text-[20rem] md:text-[24rem] -top-24 -right-6 hidden sm:block select-none"
          >
            像
          </span>

          <p className="micro reveal flex items-center gap-2.5" style={{ "--i": 0 }}>
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("addfig.kicker", { default: "AJOUTER" })}
            <span aria-hidden className="ja not-italic text-[var(--color-or)]">像</span>
            {t("addfig.kicker_label", { default: "CATALOGUE" })}
          </p>
          <h1
            className="display text-5xl md:text-6xl mt-3 text-[var(--color-ivoire)] leading-[0.95] reveal"
            style={{ "--i": 1 }}
          >
            <AccentTitle text={t("addfig.title")} />
          </h1>
          <div className="gold-rule w-24 mt-6 reveal" style={{ "--i": 2 }} />
          <p
            className="display-italic text-[var(--color-or)] text-lg mt-5 max-w-xl reveal"
            style={{ "--i": 3 }}
          >
            {t("addfig.gloss", {
              default:
                "Une nouvelle pièce au catalogue — décrite à la main, ou pré-remplie depuis une source externe.",
            })}
          </p>
        </header>

        {/* ─── "Deux façons d'entrer" — the hard product rule, made visible.
            The actual lookup / scan controls live inside the form below; this
            band just orients the user so manual entry never feels like the
            lesser path. ─── */}
        <section
          className="reveal grid sm:grid-cols-2 gap-px mb-10 border border-[var(--color-or)]/20 bg-[var(--color-or)]/10"
          style={{ "--i": 4 }}
          aria-label={t("addfig.ways.heading", { default: "Deux façons d'ajouter" })}
        >
          <WayCard
            kanji="筆"
            title={t("addfig.ways.manual.title", { default: "Saisie manuelle" })}
            body={t("addfig.ways.manual.body", {
              default:
                "Remplissez la fiche vous-même. C'est toujours possible — chaque champ s'édite à la main.",
            })}
          />
          <WayCard
            kanji="検"
            accent
            title={t("addfig.ways.lookup.title", { default: "Recherche & scan" })}
            body={t("addfig.ways.lookup.body", {
              default:
                "Cherchez sur MFC / AniList / orzgk, collez un lien, ou scannez un code-barres — les champs trouvés se pré-remplissent. À retoucher ensuite.",
            })}
          />
        </section>

        {/* Scanned-barcode notice — only when arriving from a no-match scan
            (BrowsePage → /figures/new?jan=…). Confirms the JAN is already in
            the form so the user knows where the scan landed. */}
        {scannedJan ? (
          <div
            className="reveal mb-8 flex items-start gap-3 border-l-2 border-[var(--color-or)] bg-[var(--color-or)]/5 px-4 py-3"
            style={{ "--i": 5 }}
            role="status"
          >
            <span aria-hidden className="ja text-xl text-[var(--color-or)] leading-none mt-0.5">
              印
            </span>
            <p className="text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
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

        {/* ─── Form panel ─── */}
        {/* `Card` doesn't forward `style`, so the reveal stagger index rides on
            a wrapper rather than the Card itself. */}
        <div className="reveal" style={{ "--i": 6 }}>
        <Card className="relative overflow-hidden p-6 md:p-8">
          <span
            aria-hidden
            className="kanji-mark text-[11rem] -top-10 -right-4 select-none"
          >
            像
          </span>

          <header className="relative mb-6">
            <p className="micro flex items-center gap-2">
              <span
                className="ja not-italic text-base text-[var(--color-or)] leading-none"
                aria-hidden
              >
                像
              </span>
              {t("addfig.form.eyebrow", { default: "Fiche catalogue" })}
            </p>
            <h2 className="display text-2xl md:text-3xl mt-2 text-[var(--color-ivoire)] leading-tight">
              {t("addfig.form.title", { default: "La fiche" })}
            </h2>
            <div className="gold-rule w-16 mt-4" />
          </header>

          <div className="relative">
            <FigureForm
              mode="create"
              initial={scannedJan ? { jan: scannedJan } : undefined}
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
        </div>

      </main>
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
 *  accent (it's the showier path); the manual side stays gold/quiet so it
 *  reads as the dependable default, never the afterthought. */
function WayCard({ kanji, title, body, accent = false }) {
  return (
    <div className="bg-[var(--color-noir-soft)] p-5 flex items-start gap-3.5">
      <span
        aria-hidden
        className="ja text-2xl leading-none mt-0.5 shrink-0"
        style={{
          color: accent ? "var(--color-laque-bright)" : "var(--color-or)",
          opacity: accent ? 1 : 0.85,
        }}
      >
        {kanji}
      </span>
      <div className="min-w-0">
        <h3 className="display text-lg text-[var(--color-ivoire)] leading-tight">
          {title}
        </h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ivoire-soft)]">
          {body}
        </p>
      </div>
    </div>
  );
}

/** "Also add the freshly-created figure to my collection" — promoted from a
 *  bare checkbox to a bordered gold-accent control with a hint, so the
 *  catalogue-vs-collection distinction is legible at submit time. Keeps the
 *  same controlled-checkbox contract the page wires up. */
function AlsoAddToggle({ checked, onChange, disabled, t }) {
  return (
    <label
      className="flex items-start gap-3 cursor-pointer select-none p-4 border bg-[var(--color-noir)]/40 transition-colors"
      style={{
        borderColor: checked
          ? "color-mix(in oklab, var(--color-or) 45%, transparent)"
          : "color-mix(in oklab, var(--color-or) 18%, transparent)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="accent-[var(--color-or)] w-4 h-4 mt-0.5"
      />
      <span className="flex-1">
        <span className="block text-sm text-[var(--color-ivoire)]">
          {t("addfig.also_add")}
        </span>
        <span className="block micro-tight mt-1 opacity-80">
          {t("addfig.also_add_hint", {
            default:
              "Décoché : la fiche rejoint le catalogue sans entrer dans votre vitrine.",
          })}
        </span>
      </span>
    </label>
  );
}
