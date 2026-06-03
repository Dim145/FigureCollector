import { Link } from "react-router-dom";
import { typeHue } from "../lib/typeHue.js";
import { nsfwClass } from "../lib/nsfw.js";
import { fmtMoney } from "../lib/money.js";
import FollowButton from "./FollowButton.jsx";

/**
 * A public collector presented as an exhibition piece:
 * wax-seal monogram, name + handle, pieces / value (opt-in) / followers, a
 * 4-well shelf peek, and the follow action. A "vous suit" plaque appears when
 * they already follow the viewer.
 *
 * `nsfwPref` is the viewer's nsfw_visibility — peek thumbnails blur per the
 * viewer even when the collector chose to show NSFW publicly.
 */
export default function CollectorCard({ c, locale, nsfwPref, t }) {
  const initial = [...(c.display_name || c.username || "?")][0];
  const dominant = c.value && c.value.length ? c.value[0] : null;

  return (
    <article className="relative flex flex-col bg-[var(--color-noir-soft)] border border-[color-mix(in_oklab,var(--color-or)_16%,transparent)] p-[1.15rem_1.2rem_1.2rem]">
      {c.follows_viewer ? (
        <span className="absolute top-[0.85rem] right-[0.9rem] fc-chip fc-chip--jade">
          {t("follow.follows_you")}
        </span>
      ) : null}

      {/* head */}
      <div className="flex items-center gap-[0.85rem]">
        <span className="fc-seal" aria-hidden>
          {initial}
        </span>
        <div className="min-w-0">
          <div className="display text-[1.45rem] leading-[1.05] text-[var(--color-ivoire)] truncate">
            {c.display_name}
          </div>
          <div className="ja text-[11px] tracking-[0.08em] text-[var(--color-or-pale)] mt-[0.15rem] truncate">
            @{c.username}
          </div>
        </div>
      </div>

      <div
        className="h-px my-[0.95rem]"
        style={{
          background:
            "linear-gradient(to right,color-mix(in oklab,var(--color-or) 30%,transparent),transparent)",
        }}
      />

      {/* stats */}
      <div className="flex gap-[1.4rem] mb-4">
        <Stat value={c.pieces} label={t("collector.pieces")} />
        {dominant ? (
          <Stat
            value={fmtMoney(Math.round(Number(dominant.amount)), dominant.currency, locale)}
            label={t("collector.value")}
            tone="gold"
          />
        ) : null}
        <Stat value={c.followers} label={t("collector.followers")} tone="jade" />
      </div>

      {/* shelf peek */}
      {c.preview && c.preview.length ? (
        <div className="flex gap-[0.4rem] mb-[0.2rem]">
          {c.preview.map((p) => (
            <PeekWell key={p.figure_id} item={p} nsfwPref={nsfwPref} />
          ))}
        </div>
      ) : (
        <div className="text-[11px] italic text-[var(--color-ivoire-soft)] py-2">
          {t("collector.empty_shelf")}
        </div>
      )}

      {/* foot */}
      <div className="mt-[1.05rem] flex items-center justify-between gap-[0.6rem]">
        {c.is_public ? (
          <Link
            to={`/u/${c.username}`}
            className="text-[10px] tracking-[0.14em] uppercase text-[var(--color-or-pale)] border-b border-[color-mix(in_oklab,var(--color-or)_35%,transparent)] pb-px hover:text-[var(--color-ivoire)]"
          >
            {t("collector.view_vitrine")} →
          </Link>
        ) : (
          <span />
        )}
        <FollowButton username={c.username} isFollowing={c.is_following} />
      </div>
    </article>
  );
}

function Stat({ value, label, tone }) {
  const color =
    tone === "gold"
      ? "var(--color-or-pale)"
      : tone === "jade"
        ? "var(--color-jade)"
        : "var(--color-ivoire)";
  return (
    <span className="flex flex-col">
      <span
        className="display text-[1.45rem] leading-none"
        style={{ color }}
      >
        {value}
      </span>
      <span className="text-[8px] tracking-[0.18em] uppercase text-[var(--color-or-pale)] mt-[0.3rem]">
        {label}
      </span>
    </span>
  );
}

function PeekWell({ item, nsfwPref }) {
  const blur = nsfwClass(item.is_nsfw, nsfwPref);
  return (
    <span
      className="relative flex-1 overflow-hidden border border-[color-mix(in_oklab,var(--hue,var(--color-or))_22%,transparent)]"
      style={{
        aspectRatio: "3 / 4",
        "--hue": typeHue(item.figure_type),
        background:
          "radial-gradient(circle at 30% 18%,var(--color-noir-soft),var(--color-noir-deep) 62%)",
      }}
    >
      <span
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg,transparent,var(--hue) 30%,var(--hue) 70%,transparent)",
        }}
      />
      {item.figure_image ? (
        <img
          src={item.figure_image}
          alt=""
          loading="lazy"
          className={`absolute inset-0 w-full h-full object-cover ${blur}`}
        />
      ) : (
        <span
          className="absolute inset-0 grid place-items-center ja text-[1.4rem]"
          style={{ color: "color-mix(in oklab,var(--hue,var(--color-or)) 52%,transparent)" }}
        >
          ◇
        </span>
      )}
    </span>
  );
}
