import FigureCard from "../../components/FigureCard.jsx";
import Money from "../../components/Money.jsx";
import Reveal from "../../components/motion/Reveal.jsx";
import { resolveOwnedCover } from "../../lib/coverUrl.js";

/**
 * The "À vendre / à échanger" specimens on a public profile. Each is a
 * `FigureCard` with a small sale footer: hanko-red "À vendre" + gold "À
 * échanger" markers (the red sale tag is the one hot accent here), the gold
 * asking price via `<Money>`, and the owner's public note. Asking price is a
 * published sale price — not gated by the value opt-in.
 */
export default function ForSaleGrid({ entries, t }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {entries.map((e, i) => (
        <Reveal as="li" key={e.owned_id} delay={Math.min(i, 7) * 0.05} y={24}>
          <FigureCard
            figureId={e.figure_id}
            href={`/figures/${e.figure_id}`}
            name={e.figure_name}
            type={e.figure_type}
            manufacturer={e.manufacturer_name}
            imageUrl={resolveOwnedCover(e)}
            scale={e.scale}
            versionName={e.version_name}
          />
          <div className="mt-3 px-1 flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
            {e.for_sale ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] border border-[var(--color-laque-bright)]/60 text-[var(--color-laque-bright)] bg-[var(--color-laque)]/10">
                {t("owned.editor.sale.for_sale", { default: "À vendre" })}
              </span>
            ) : null}
            {e.for_trade ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] border border-[var(--color-or)]/50 text-[var(--color-or-pale)]">
                {t("owned.editor.sale.for_trade", { default: "À échanger" })}
              </span>
            ) : null}
            {e.for_sale && e.asking_price_amount ? (
              <span className="text-[var(--color-or)] font-medium">
                <Money amount={e.asking_price_amount} currency={e.asking_price_currency} />
              </span>
            ) : null}
          </div>
          {e.sale_note ? (
            <p className="mt-1 px-1 text-[13px] italic text-[var(--color-ivoire-soft)] whitespace-pre-wrap">
              {e.sale_note}
            </p>
          ) : null}
        </Reveal>
      ))}
    </ul>
  );
}
