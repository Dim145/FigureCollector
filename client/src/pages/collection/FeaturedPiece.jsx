import { Link } from "react-router-dom";
import Button from "../../components/Button.jsx";
import Money from "../../components/Money.jsx";
import { resolveOwnedCover } from "../../lib/coverUrl.js";
import { typeHue, typeKanji } from "../../lib/typeHue.js";

/**
 * "À la une" — the pinned piece, featured atop the collection as an asymmetric
 * editorial spread: a stage-lit photo (in the figure's type hue) beside a
 * cartouche — name, maker, the user's own note as a pull-quote, glanceable
 * specs, and the actions. Only rendered when a piece is pinned.
 *
 * GPU-light: static radial gradients + a hairline accent bar only; the single
 * transform is the gentle photo zoom on hover.
 */
export default function FeaturedPiece({ item, t, onUnpin }) {
  const cover = resolveOwnedCover(item);
  const kanji = typeKanji(item.figure_type);
  const note = item.notes || item.note;
  const paid =
    item.price_amount != null ? (
      <Money amount={item.price_amount} currency={item.price_currency || "EUR"} />
    ) : null;
  return (
    <section
      className="reveal mb-10 relative overflow-hidden border border-[var(--color-or)]/18 bg-[color-mix(in_oklab,var(--color-noir-soft)_70%,transparent)]"
      style={{ "--hue": typeHue(item.figure_type) }}
      aria-label={t("collection.featured.kicker", { default: "À la une" })}
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-[2px] z-10"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--hue) 30%, var(--hue) 70%, transparent)",
        }}
      />
      <div className="grid md:grid-cols-[1.1fr_1fr]">
        <Link
          to={`/figures/${item.figure_id}`}
          className="group/feat relative block aspect-[5/4] md:aspect-auto md:min-h-[340px] overflow-hidden bg-[var(--color-noir-deep)]"
        >
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 55% at 32% 24%, color-mix(in oklab, var(--hue) 24%, transparent), transparent 70%)",
            }}
          />
          <span
            aria-hidden
            className="ja absolute -right-3 -bottom-8 text-[13rem] leading-none select-none"
            style={{ color: "color-mix(in oklab, var(--hue) 12%, transparent)" }}
          >
            {kanji}
          </span>
          {cover ? (
            <img
              src={cover}
              alt={item.figure_name ?? ""}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-contain p-5 z-[1] transition-transform duration-700 ease-[var(--ease-curtain)] group-hover/feat:scale-[1.03]"
            />
          ) : (
            <span className="absolute inset-0 grid place-items-center ja text-[8rem] text-[var(--color-or)]/25 z-[1]">
              {kanji}
            </span>
          )}
          <span className="label-plaque absolute top-3 left-3 z-[2]">
            <span className="label-plaque-kanji" aria-hidden>
              {kanji}
            </span>
            <span>{t(`type.${item.figure_type ?? "other"}`)}</span>
          </span>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-16 z-[1]"
            style={{ background: "linear-gradient(transparent, var(--color-noir-deep))" }}
          />
        </Link>

        <div className="relative p-7 md:p-9 flex flex-col justify-center">
          <span
            aria-hidden
            className="ja absolute top-5 right-6 text-5xl select-none"
            style={{ color: "color-mix(in oklab, var(--color-or) 15%, transparent)" }}
          >
            推
          </span>
          <p className="micro flex items-center gap-2.5">
            <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
            {t("collection.featured.kicker", { default: "À la une · épinglé" })}
          </p>
          <h2 className="display text-3xl md:text-4xl mt-2.5 leading-[1.02] text-[var(--color-ivoire)]">
            {item.figure_name ?? ""}
          </h2>
          {item.manufacturer_name ? (
            <p className="micro mt-2.5 text-[var(--color-or-pale)]">{item.manufacturer_name}</p>
          ) : null}
          {note ? (
            <p className="display-italic text-[var(--color-ivoire-soft)] text-base md:text-lg my-5 border-l-2 border-[var(--color-or)]/35 pl-3.5 line-clamp-3">
              « {note} »
            </p>
          ) : (
            <div className="gold-rule w-16 my-6" />
          )}
          <dl className="flex flex-wrap gap-x-9 gap-y-3 mb-7">
            {paid ? (
              <div>
                <dt className="micro-tight text-[var(--color-ivoire-soft)]/70">
                  {t("collection.kpi.paid")}
                </dt>
                <dd className="figural text-lg text-[var(--color-or)] mt-1">{paid}</dd>
              </div>
            ) : null}
            {item.scale ? (
              <div>
                <dt className="micro-tight text-[var(--color-ivoire-soft)]/70">
                  {t("figure.spec.scale")}
                </dt>
                <dd className="figural text-lg text-[var(--color-ivoire)] mt-1">{item.scale}</dd>
              </div>
            ) : null}
            <div>
              <dt className="micro-tight text-[var(--color-ivoire-soft)]/70">
                {t("collection.featured.state", { default: "État" })}
              </dt>
              <dd className="figural text-lg text-[var(--color-ivoire)] mt-1">
                {t(`condition.${item.condition}`)}
              </dd>
            </div>
          </dl>
          <div className="flex items-center gap-3">
            <Button
              as={Link}
              to={`/figures/${item.figure_id}`}
              variant="primary"
              size="sm"
              className="uppercase"
            >
              {t("collection.featured.view", { default: "Voir la fiche" })}
            </Button>
            <Button variant="ghost" size="sm" className="uppercase" onClick={onUnpin}>
              {t("collection.unpin", { default: "Désépingler" })}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
