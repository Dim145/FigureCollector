import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Share2, Trash2 } from "lucide-react";
import { typeHue, typeKanji } from "../../lib/typeHue.js";
import { nsfwClass } from "../../lib/nsfw.js";
import { preorderPhase, preorderPhaseFromFigure } from "../../lib/preorderStatus.js";
import AccentTitle from "../../components/AccentTitle.jsx";
import FigureHero from "../../components/FigureHero.jsx";
import MangaLinkBadge from "../../components/MangaLinkBadge.jsx";
import AddToCollectionForm from "../../components/AddToCollectionForm.jsx";
import { OwnerGlance, WishlistCta, OwnedConfirmation } from "./OwnerGlancePanel.jsx";

/**
 * The hero — a two-column editorial spread (`lg:grid-cols-[1.2fr_1fr]`):
 *   left  — FigureHero shoppable gallery
 *   right — kicker → lot stamp + action cluster → title → notice/description →
 *           headline specs → owner glance → contextual primary CTA.
 *
 * The single contextual primary CTA lives at the foot of the right column:
 *   not owned → "＋ Ajouter à ma collection" (the AddToCollectionForm submit,
 *               with a wishlist toggle above it)
 *   owned     → "✎ Éditer ma pièce" (scrolls to the owner editor below)
 *
 * On mobile the grid collapses to one column (gallery → title → actions); the
 * gallery itself turns its thumbnails into a horizontal strip internally.
 */
export default function FigureHeroPanel({
  f,
  ownedRecord,
  alreadyOwned,
  canEdit,
  nsfwPref,
  t,
  onEdit,
  onDelete,
  onShare,
  onEditMine,
}) {
  return (
    <section className="relative" style={{ "--hue": typeHue(f.figure_type) }}>
      {/* The product page glows in its figure's TYPE colour — a static hero
          wash (type hue + gold) over the global aurora. GPU-light: a fixed
          radial gradient, no animation or filter. Theme-aware. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 left-0 right-0 h-[460px] -z-0"
        style={{
          background:
            "radial-gradient(46% 70% at 22% 0%, color-mix(in oklab, var(--hue) 24%, transparent), transparent 68%), radial-gradient(40% 60% at 84% 12%, color-mix(in oklab, var(--color-or) 18%, transparent), transparent 72%)",
          // Fade the wash IN below the sticky header — the radials peak at the
          // box's top edge, which sits inside the header band, so without this
          // mask their hard top edge drew a line straight across the navbar.
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

      <div className="relative max-w-7xl mx-auto px-6 pt-12 md:pt-16 grid lg:grid-cols-[1.2fr_1fr] gap-10 lg:gap-14 items-start">
        <FigureHero
          figure={f}
          ownedItemId={ownedRecord?.id ?? null}
          figureTypeKanji={typeKanji(f.figure_type)}
          nsfwBlurClass={nsfwClass(f.is_nsfw, nsfwPref)}
        />

        <div className="relative pt-2 min-w-0">
          {/* `min-w-0` mirrors the FigureHero side — both grid items need it
           *  for the track to resolve. Without it a long unbreakable token in
           *  the title would expand this column past its share and overflow. */}
          <HeroKicker f={f} owned={ownedRecord} t={t} />

          {/* Lot stamp + action cluster — wrap on narrow viewports so neither
           *  overflows when both are present. */}
          <div
            className="mt-4 flex flex-wrap items-start justify-between gap-3 reveal"
            style={{ "--i": 1 }}
          >
            <div className="fig-lot">
              <span className="fig-lot-label">{t("figure.lot.eyebrow")}</span>
              <span className="fig-lot-value">
                Nº{" "}
                {String(f.id ?? "")
                  .slice(0, 8)
                  .toUpperCase()}
              </span>
              <span className="fig-lot-label">{t("figure.lot.kind")}</span>
              <span className="fig-lot-value">{t(`type.${f.figure_type ?? "other"}`)}</span>
            </div>

            <ActionCluster
              canEdit={canEdit}
              onEdit={onEdit}
              onDelete={onDelete}
              onShare={onShare}
              t={t}
            />
          </div>

          <h1
            className={`fig-title mt-7 reveal ${
              (f.name?.length ?? 0) > 38 ? "fig-title--long" : ""
            }`}
            style={{ "--i": 3 }}
          >
            <AccentTitle text={f.name} />
            {f.version_name ? <span className="fig-title-version">{f.version_name}</span> : null}
          </h1>

          {/* Title rule carries the figure's type hue (fades to gold). */}
          <div
            className="w-32 my-7 h-px reveal"
            style={{
              "--i": 4,
              background:
                "linear-gradient(90deg, var(--hue), color-mix(in oklab, var(--color-or) 60%, transparent) 70%, transparent)",
            }}
          />

          {f.description ? (
            <>
              <SectionLabel
                accent={t("figure.label.notice", { default: "Notice" })}
                rest={t("figure.label.notice_rest", { default: "DE LA PIÈCE" })}
                delay={5}
              />
              <DescriptionBlock text={f.description} t={t} delay={5} />
            </>
          ) : null}

          {/* Spec grid — fabricant / série / personnage / échelle. The ONLY
           *  place these rows appear (the cartouche deliberately skips them). */}
          <HeadlineSpecs f={f} t={t} delay={6} />

          {/* Owner-only glance blocks — acompte progress + La Cote. Read-only
           *  summaries; the editable detail lives in the owner stack below. */}
          {ownedRecord ? <OwnerGlance f={f} owned={ownedRecord} t={t} delay={7} /> : null}

          {/* MangaCollector synergy — renders only when the user has linked
           *  their manga library AND this figure's series is in it. */}
          <MangaLinkBadge figureId={f.id} />

          {/* Contextual primary CTA — exactly one per page. */}
          <div className="mt-9 reveal" style={{ "--i": 8 }}>
            {alreadyOwned ? (
              <OwnedCta t={t} onEditMine={onEditMine} />
            ) : (
              <>
                <WishlistCta figureId={f.id} t={t} />
                <div className="wish-or">{t("wishlist.or")}</div>
                <AddToCollectionForm
                  figureId={f.id}
                  catalogMsrp={f.msrp_amount}
                  catalogCurrency={f.msrp_currency}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Owned state: a quiet "déjà dans ta collection" seal + the single primary
 *  CTA "✎ Éditer ma pièce", which jumps to the owner editor below. */
function OwnedCta({ t, onEditMine }) {
  return (
    <div className="space-y-4">
      <OwnedConfirmation t={t} />
      <button type="button" onClick={onEditMine} className="wish-cta wish-cta--on">
        <Pencil size={16} aria-hidden />
        {t("figure.edit_mine.cta", { default: "Éditer ma pièce" })}
      </button>
    </div>
  );
}

/** Hero action cluster — share always; edit + delete for catalog editors.
 *  Quiet chrome; delete is the only red affordance (loss/danger). */
function ActionCluster({ canEdit, onEdit, onDelete, onShare, t }) {
  return (
    <div className="fig-actions reveal" style={{ "--i": 2 }}>
      <button
        type="button"
        onClick={onShare}
        title={t("figure.action.share")}
        aria-label={t("figure.action.share")}
      >
        <Share2 size={16} aria-hidden />
      </button>
      {canEdit ? (
        <>
          <button
            type="button"
            onClick={onEdit}
            title={t("figure.edit.cta")}
            aria-label={t("figure.edit.cta")}
          >
            <Pencil size={16} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="danger"
            title={t("figure.edit.delete")}
            aria-label={t("figure.edit.delete")}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** Editorial kicker over the headline — `SÉRIE · 予約 · PRÉ-COMMANDE`. Generic
 *  *labels* (not the series value, which the spec grid carries) so nothing
 *  repeats: the leading label is "Série" (linking when a slug exists) or the
 *  type; the kanji is 予 for a (future) pre-order else the type glyph; the
 *  trailing word states the status. */
function HeroKicker({ f, owned, t }) {
  const phase = owned ? preorderPhase(owned) : preorderPhaseFromFigure(f);
  const isPreorder = phase === "preorder" || phase === "imminent";
  const kanji = isPreorder ? "予" : typeKanji(f.figure_type);
  const trail = isPreorder
    ? t("figure.kicker.preorder", { default: "PRÉ-COMMANDE" })
    : owned
      ? t("figure.kicker.owned", { default: "MA PIÈCE" })
      : t("figure.kicker.piece", { default: "LA PIÈCE" });
  return (
    <p className="micro reveal flex items-center gap-2.5 flex-wrap" style={{ "--i": 0 }}>
      <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
      {f.series_name ? (
        f.series_slug ? (
          <Link
            to={`/catalogue/series/${f.series_slug}`}
            className="hover:text-[var(--color-or)] transition-colors"
          >
            {t("figure.spec.series")}
          </Link>
        ) : (
          <span>{t("figure.spec.series")}</span>
        )
      ) : (
        <span>{t(`type.${f.figure_type ?? "other"}`)}</span>
      )}
      <span aria-hidden className="ja not-italic text-[var(--color-or)] text-sm leading-none">
        {kanji}
      </span>
      <span>{trail}</span>
    </p>
  );
}

/** Quiet red-accent section label — a kicker whose leading word is set in the
 *  hanko-red display italic (the AccentTitle move, applied to a label). Gives
 *  the right column the mockup's sectioned rhythm without accenting the name. */
function SectionLabel({ accent, rest, delay = 5 }) {
  return (
    <div className="reveal flex items-center gap-3 mb-3" style={{ "--i": delay }}>
      <p className="text-[11px] uppercase tracking-[0.34em] leading-none">
        <span className="display-italic text-[var(--color-laque-bright)]">{accent}</span>
        {rest ? <span className="text-[var(--color-or-pale)]"> {rest}</span> : null}
      </p>
      <span
        aria-hidden
        className="flex-1 h-px"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in oklab, var(--color-or) 45%, transparent), transparent)",
        }}
      />
    </div>
  );
}

/** Headline specs rail — fabricant / série / personnage / échelle. These four
 *  are the ONLY place these rows appear on the page; the cartouche skips them. */
function HeadlineSpecs({ f, t, delay = 6 }) {
  const rows = [
    {
      label: t("figure.spec.manufacturer"),
      value: f.manufacturer_name,
      href: f.manufacturer_slug ? `/catalogue/manufacturers/${f.manufacturer_slug}` : null,
    },
    {
      label: t("figure.spec.series"),
      value: f.series_name,
      href: f.series_slug ? `/catalogue/series/${f.series_slug}` : null,
    },
    {
      label: t("figure.spec.character"),
      value: f.character_name,
      href: f.character_slug ? `/catalogue/characters/${f.character_slug}` : null,
    },
    {
      label: t("figure.spec.scale"),
      value: f.scale,
    },
  ].filter((r) => !!r.value);
  if (rows.length === 0) return null;
  // Thin filets rail: a hairline per row, a mono-caps label over a
  // display-serif value — an editorial spec list rather than a boxed grid.
  return (
    <dl className="fig-specrail reveal" style={{ "--i": delay }}>
      {rows.map((r) => (
        <div key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            {r.href ? (
              <Link
                to={r.href}
                className="hover:text-[var(--color-or-pale)] transition-colors underline decoration-[var(--color-or)]/30 underline-offset-4 hover:decoration-[var(--color-or)]"
              >
                {r.value}
              </Link>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// =============================================================================
// Description — split a scraped blob into prose + a clean spec grid.
// =============================================================================

/** Split a scraped description into free prose + a `key: value` spec block.
 *  Only treated as a spec list when there's a real run of such lines (≥3), so
 *  genuine prose (incl. sentences with a stray colon) is left untouched. */
function parseDescription(text) {
  const raw = text ?? "";
  const specRe = /^([\p{L}][\p{L}\d .()/+&'-]{1,22}):\s*(\S.*?)\s*$/u;
  const prose = [];
  const specs = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(specRe);
    const labelWords = m ? m[1].trim().split(/\s+/).length : 0;
    // A spec row = short label, compact value, value not a full sentence.
    if (m && labelWords <= 4 && m[2].length <= 70 && !/[.!?…]\s*$/.test(m[2])) {
      specs.push([m[1].trim(), m[2].trim()]);
    } else {
      prose.push(trimmed);
    }
  }
  if (specs.length < 3) return { prose: raw, specs: [] };
  return { prose: prose.join("\n"), specs };
}

/** Decide how the description reads as a magazine feature. Scraped dumps are
 *  noisy, so a drop-cap lede is only promoted when the opening line is
 *  genuinely prose; otherwise everything renders as plain body. */
function isLedeWorthy(line) {
  if (!/^\p{L}/u.test(line)) return false; // opens on a letter
  if (line.split(/\s+/).length < 6) return false; // a sentence, not a label
  if (/^.{0,24}[:：]/.test(line)) return false; // "Source:" / "Label: value"
  return true;
}

function splitDescription(prose) {
  const lines = prose
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      if (/^(source|url|lien|link|via|réf|ref)\s*[:：]/i.test(l)) return false;
      const urlLen = (l.match(/https?:\/\/\S+/g) || []).join("").length;
      return urlLen <= l.length * 0.4;
    });
  if (lines.length === 0) return { lede: "", body: "" };
  const first = lines[0];
  if (!isLedeWorthy(first)) return { lede: "", body: lines.join("\n") };
  if (lines.length > 1) return { lede: first, body: lines.slice(1).join("\n") };
  if (first.length <= 240) return { lede: first, body: "" };
  const cut = first.slice(0, 240);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const at = stop > 120 ? stop + 1 : 240;
  return { lede: first.slice(0, at).trim(), body: first.slice(at).trim() };
}

function DescriptionBlock({ text, t, delay = 5 }) {
  const [expanded, setExpanded] = useState(false);
  const { prose, specs } = useMemo(() => parseDescription(text), [text]);
  const { lede, body } = useMemo(() => splitDescription(prose), [prose]);
  // A lede only exists when the opening line is prose-worthy → always drop-cap.
  const dropCap = !!lede;

  const isLong = body.length > 240;
  const display = !isLong || expanded ? body : body.slice(0, 220).trimEnd() + "…";

  return (
    <div className="reveal mb-7" style={{ "--i": delay }}>
      {/* Editorial lede — italic display + gold drop-cap. `break-words` +
       *  `overflow-wrap: anywhere` keep imported descriptions with bare URLs
       *  from overflowing the grid track. */}
      {lede ? (
        <p
          className={`fig-lede break-words [overflow-wrap:anywhere] ${dropCap ? "fig-lede--cap" : ""}`}
        >
          {lede}
        </p>
      ) : null}
      {body ? (
        <p className="text-[var(--color-ivoire-soft)] leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {display}
        </p>
      ) : null}
      {body && isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-2 text-[10px] uppercase tracking-[0.22em] text-[var(--color-or-pale)] hover:text-[var(--color-or)] transition-colors"
        >
          {expanded
            ? "− " + t("figure.description.collapse")
            : "+ " + t("figure.description.expand")}
        </button>
      ) : null}

      {/* Spec block parsed out of the scraped dump — a clean key/value grid. */}
      {specs.length > 0 ? (
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm"
          style={
            prose
              ? {
                  marginTop: "1.25rem",
                  paddingTop: "1.25rem",
                  borderTop: "1px solid color-mix(in oklab, var(--color-or) 18%, transparent)",
                }
              : undefined
          }
        >
          {specs.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="contents">
              <dt className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-or-pale)] py-0.5 whitespace-nowrap">
                {k}
              </dt>
              <dd className="text-[var(--color-ivoire)] py-0.5 break-words [overflow-wrap:anywhere]">
                {/^https?:\/\//.test(v) ? (
                  <a
                    href={v}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-[var(--color-or-pale)] hover:text-[var(--color-or)] underline underline-offset-2 transition-colors"
                  >
                    {v.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
