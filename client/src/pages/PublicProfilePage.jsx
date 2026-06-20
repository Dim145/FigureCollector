import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { usePublicProfile } from "../hooks/useProfile.js";
import { typeHue, typeKanji } from "../lib/typeHue.js";
import { standeeWidthPx } from "../lib/standee.js";
import Money from "../components/Money.jsx";
import AppShell from "../components/AppShell.jsx";
import AccentTitle from "../components/AccentTitle.jsx";
import Card from "../components/Card.jsx";
import StatCard from "../components/StatCard.jsx";
import FigureCard from "../components/FigureCard.jsx";
import Button from "../components/Button.jsx";
import Reveal from "../components/motion/Reveal.jsx";
import FollowButton from "../components/FollowButton.jsx";
import FollowListModal from "../components/FollowListModal.jsx";

/**
 * /u/:slug — a collector's public vitrine, redrawn to Direction A ("Shōjo-Noir").
 *
 * An editorial profile rather than a stats dashboard:
 *   - a strong header — avatar (or a 像 monogram), a `.micro` kicker
 *     (COLLECTIONNEUR · 蒐 · @slug), the display name as an `<AccentTitle>`
 *     `.display` h1, a gold-rule, then the red `FollowButton` pill + a Compare
 *     ghost and the clickable follower / following counts;
 *   - a figurine `StatCard` strip (pieces · series · manufacturers, plus the
 *     gold Valeur card only when the owner has opted to publish it);
 *   - their pieces in the refined `FigureCard` grid under a kanji section head.
 *
 * Privacy is enforced server-side and mirrored here unchanged: NSFW figures are
 * already filtered out of `collection`/`stats` by the API, and `value` arrives
 * empty unless the owner opted in — so the gold value card simply never renders
 * when there's nothing to show. GPU-light: flat fills, hairlines, one static
 * wash, the shared `Reveal` enter motion; no animated meshes / blur / glows.
 */
export default function PublicProfilePage() {
  const { slug } = useParams();
  const t = useT();
  const me = useMe();
  const profile = usePublicProfile(slug);
  const [list, setList] = useState(null);
  const [vitrineView, setVitrineView] = useState("grid"); // "grid" | "diorama"

  // No auth gate: the public showcase is viewable by anyone. The server only
  // returns a profile when its owner opted in (`public_profile_enabled`) — a
  // private or unknown slug 404s and we render the "private" state below.
  if (me.isLoading) return null;

  if (profile.isLoading) return <AppShell><Loading /></AppShell>;
  if (profile.error || !profile.data)
    return (
      <AppShell>
        <main className="max-w-md mx-auto px-6 py-16 text-center">
          <span aria-hidden className="ja block text-6xl text-[var(--color-or)]/30 leading-none">
            鍵
          </span>
          <p className="display text-3xl mt-5 text-[var(--color-ivoire)]">404</p>
          <div className="gold-rule mx-auto w-16 my-6" />
          <p className="text-[var(--color-ivoire-soft)]">{t("profile.private")}</p>
        </main>
      </AppShell>
    );

  const { user, stats, collection, social, value } = profile.data;
  const isSelf = social?.is_self ?? me.data?.user?.username === user.username;
  const locale = me.data?.user?.locale;
  // `value` is opt-in (empty array unless the owner published their cote) and
  // already DESC by amount → the dominant currency leads, "…" hints at more.
  const dominantValue = value && value.length ? value[0] : null;
  // Pieces the owner listed for sale / trade — drive the showcase "À vendre"
  // section. Asking price is a published sale price (not gated by show_value).
  const forSale = collection.filter((e) => e.for_sale || e.for_trade);

  return (
    <AppShell>
      <main className="relative max-w-6xl mx-auto px-6 py-12 sm:py-16">
        {/* Quiet gallery wash — a single static gold/jade radial pinned behind
            the header (GPU-free) over the global aurora. Feathered edges so it
            fades into the column instead of hard-cutting. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 left-0 right-0 h-[380px] -z-0"
          style={{
            background:
              "radial-gradient(46% 62% at 22% 0%, color-mix(in oklab, var(--color-or) 18%, transparent), transparent 70%), radial-gradient(44% 58% at 84% 6%, color-mix(in oklab, var(--color-jade) 14%, transparent), transparent 72%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
            maskImage:
              "linear-gradient(to right, transparent 0, #000 8%, #000 92%, transparent 100%)",
          }}
        />

        {/* ─── Editorial profile header ─── */}
        <header className="relative mb-12">
          <span
            aria-hidden
            className="kanji-mark text-[20rem] sm:text-[26rem] -top-28 -right-8 hidden md:block select-none"
          >
            蒐
          </span>

          <div className="relative flex flex-col sm:flex-row sm:items-start gap-6 sm:gap-8">
            <Reveal as="div" y={18} className="shrink-0">
              <Avatar src={user.avatar_url} name={user.display_name} />
            </Reveal>

            <div className="min-w-0">
              <Reveal as="div" y={18}>
                <p className="micro flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
                  {t("profile.kicker", { default: "COLLECTIONNEUR" })}
                  <span aria-hidden className="ja not-italic text-[var(--color-or)]">蒐</span>
                  <span className="normal-case tracking-[0.18em] text-[var(--color-or-pale)]">
                    @{user.username}
                  </span>
                  {social?.follows_viewer ? (
                    <span className="fc-chip fc-chip--jade tracking-[0.12em]">
                      {t("follow.follows_you")}
                    </span>
                  ) : null}
                </p>
              </Reveal>

              <Reveal
                as="h1"
                delay={0.06}
                y={18}
                className="display text-4xl sm:text-5xl md:text-6xl mt-2.5 text-[var(--color-ivoire)] leading-[0.98]"
              >
                <AccentTitle text={user.display_name} />
              </Reveal>

              <Reveal as="div" delay={0.1} className="gold-rule w-24 mt-5" />

              <Reveal
                as="p"
                delay={0.12}
                className="mt-4 text-sm text-[var(--color-ivoire-soft)]"
              >
                {t("profile.member_since", {
                  date: new Date(user.member_since).toLocaleDateString(locale),
                })}
              </Reveal>

              {/* Action row — the red follow pill is the hero CTA; counts open
                  the follow-list modal (behaviour unchanged). Hidden on one's
                  own profile, where there's nothing to follow. */}
              <Reveal
                as="div"
                delay={0.16}
                y={16}
                className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4"
              >
                {me.data?.authenticated && !isSelf ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <FollowButton username={user.username} isFollowing={social?.is_following} />
                    <Link to={`/compare/${user.username}`}>
                      <Button variant="ghost">
                        {t("compare.title", { name: user.display_name })}
                      </Button>
                    </Link>
                  </div>
                ) : null}

                <div className="flex items-center gap-5 sm:gap-6">
                  <CountButton
                    value={social?.followers ?? 0}
                    label={t("profile.stat_followers")}
                    onClick={() => setList({ tab: "followers" })}
                  />
                  <span
                    aria-hidden
                    className="w-px h-8 bg-[color-mix(in_oklab,var(--color-or)_30%,transparent)]"
                  />
                  <CountButton
                    value={social?.following ?? 0}
                    label={t("profile.stat_following")}
                    onClick={() => setList({ tab: "following" })}
                  />
                </div>
              </Reveal>
            </div>
          </div>

          {/* Figurine-metric strip — counts stay ivoire; gold is reserved for
              the Valeur card, shown only when the owner published their cote. */}
          <Reveal
            as="div"
            delay={0.2}
            className={`relative mt-9 grid grid-cols-2 gap-3 ${
              dominantValue ? "lg:grid-cols-4" : "lg:grid-cols-3"
            }`}
          >
            <StatCard label={t("profile.stat_pieces")} value={stats.pieces} />
            <StatCard label={t("profile.stat_series")} value={stats.series_count} />
            <StatCard
              label={t("profile.stat_manufacturers")}
              value={stats.manufacturers_count}
            />
            {dominantValue ? (
              <StatCard
                label={t("profile.value_label")}
                value={
                  <>
                    <Money
                      amount={dominantValue.amount}
                      currency={dominantValue.currency}
                      round
                    />
                    {value.length > 1 ? " …" : ""}
                  </>
                }
                tone="gold"
              />
            ) : null}
          </Reveal>
        </header>

        {/* ─── À vendre / à échanger — only when the owner listed pieces ─── */}
        {forSale.length > 0 ? (
          <section aria-labelledby="profile-sale-head" className="mb-14">
            <Reveal as="div" className="mb-7">
              <p id="profile-sale-head" className="micro flex items-center gap-2">
                <span aria-hidden className="ja not-italic text-base text-[var(--color-laque-bright)] leading-none">
                  売
                </span>
                {t("profile.for_sale_kicker", { default: "À VENDRE / À ÉCHANGER" })}
              </p>
              <div className="gold-rule w-16 mt-3" />
            </Reveal>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {forSale.map((e, i) => (
                <Reveal as="li" key={e.owned_id} delay={Math.min(i, 7) * 0.05} y={24}>
                  <FigureCard
                    figureId={e.figure_id}
                    href={`/figures/${e.figure_id}`}
                    name={e.figure_name}
                    type={e.figure_type}
                    manufacturer={e.manufacturer_name}
                    imageUrl={e.figure_image}
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
          </section>
        ) : null}

        {/* ─── Their vitrine ─── */}
        <section aria-labelledby="profile-vitrine-head">
          <Reveal as="div" className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p id="profile-vitrine-head" className="micro flex items-center gap-2">
                <span aria-hidden className="ja not-italic text-base text-[var(--color-or)] leading-none">
                  棚
                </span>
                {t("profile.vitrine_kicker", { default: "LA VITRINE" })}
              </p>
              <div className="gold-rule w-16 mt-3" />
            </div>
            {collection.length > 0 ? (
              <div className="view-toggle" role="group" aria-label={t("vitrines.view", { default: "Vue" })}>
                <button type="button" className={vitrineView === "grid" ? "is-on" : ""} aria-pressed={vitrineView === "grid"} onClick={() => setVitrineView("grid")}>
                  {t("vitrines.view.grid", { default: "Grille" })}
                </button>
                <button type="button" className={vitrineView === "diorama" ? "is-on" : ""} aria-pressed={vitrineView === "diorama"} onClick={() => setVitrineView("diorama")}>
                  {t("vitrines.view.diorama", { default: "Diorama" })}
                </button>
              </div>
            ) : null}
          </Reveal>

          {collection.length === 0 ? (
            <EmptyVitrine name={user.display_name} t={t} />
          ) : vitrineView === "diorama" ? (
            <ShowcaseDiorama items={collection} />
          ) : (
            <ul className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {collection.map((entry, i) => (
                <Reveal as="li" key={entry.owned_id} delay={Math.min(i, 7) * 0.05} y={24}>
                  <FigureCard
                    figureId={entry.figure_id}
                    href={`/figures/${entry.figure_id}`}
                    name={entry.figure_name}
                    type={entry.figure_type}
                    manufacturer={entry.manufacturer_name}
                    imageUrl={entry.figure_image}
                    scale={entry.scale}
                    versionName={entry.version_name}
                  />
                </Reveal>
              ))}
            </ul>
          )}
        </section>

        <FollowListModal
          open={!!list}
          slug={user.username}
          initialTab={list?.tab ?? "followers"}
          counts={{ followers: social?.followers ?? 0, following: social?.following ?? 0 }}
          onClose={() => setList(null)}
        />
      </main>
    </AppShell>
  );
}

/**
 * Profile avatar — the collector's photo in a gold-ringed disc, falling back to
 * a 像 ("statue/likeness") monogram on a noir well when none is set. Decorative
 * (the name carries the label), so the image is `alt=""`.
 */
function Avatar({ src, name }) {
  const ring = {
    boxShadow:
      "0 0 0 1px color-mix(in oklab, var(--color-or) 55%, transparent), 0 18px 40px -22px rgba(0,0,0,0.85)",
  };
  if (src) {
    return (
      <span
        className="block w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-[var(--color-noir-deep)]"
        style={ring}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      title={name}
      className="grid place-items-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-[var(--color-noir-deep)] ja text-4xl sm:text-5xl text-[var(--color-or)]/70 select-none"
      style={ring}
    >
      像
    </span>
  );
}

/** Clickable social counter — opens the followers / following list modal. */
function CountButton({ value, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap-target group text-left"
    >
      <span className="figural text-2xl sm:text-3xl leading-none text-[var(--color-ivoire)] transition-colors group-hover:text-[var(--color-or-pale)]">
        {value}
      </span>
      <span className="micro-tight block mt-1">{label}</span>
    </button>
  );
}

/** Empty vitrine — a Card with a faint 空 watermark, an eyebrow, a gold-rule
 *  and the same "nothing here yet" copy the owner sees on /collection. */
function EmptyVitrine({ name, t }) {
  return (
    <Card className="max-w-xl mx-auto p-12 text-center relative overflow-hidden frame-corners">
      <span
        aria-hidden
        className="ja absolute -top-6 -right-6 text-[14rem] text-[var(--color-or)]/10 leading-none select-none"
      >
        空
      </span>
      <p className="micro relative">{t("collection.empty.eyebrow")}</p>
      <h2 className="display text-3xl mt-3 text-[var(--color-ivoire)] relative">
        {t("profile.empty.title", { name, default: "Vitrine vide" })}
      </h2>
      <div className="gold-rule mx-auto w-20 my-8" />
      <p className="text-[var(--color-ivoire-soft)] leading-relaxed relative">
        {t("collection.empty.title")}
      </p>
    </Card>
  );
}

function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-md mx-auto px-6 py-16 text-center text-[var(--color-ivoire-soft)]"
    >
      …
    </div>
  );
}

/**
 * To-scale diorama of the public collection — pieces stand on a lit shelf sized
 * by their real height (`height_mm`), so a 1/4 statue towers over a Nendoroid.
 * Reuses the global `.diorama-*` styling + the shared `standeeWidthPx`; each
 * standee links to the figure. Covers are the catalogue images (`figure_image`).
 */
function ShowcaseDiorama({ items }) {
  return (
    <div className="diorama-shelf">
      <span aria-hidden className="diorama-spot" />
      <ul className="diorama-row">
        {items.map((e) => (
          <li
            key={e.owned_id}
            className="diorama-standee"
            style={{ "--hue": typeHue(e.figure_type), "--standee-w": `${standeeWidthPx(e)}px` }}
          >
            <Link to={`/figures/${e.figure_id}`} className="diorama-standee-btn" title={e.figure_name}>
              <span className="diorama-standee-card">
                {e.figure_image ? (
                  <img src={e.figure_image} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="diorama-standee-ph ja" aria-hidden>
                    {typeKanji(e.figure_type)}
                  </span>
                )}
              </span>
              <span aria-hidden className="diorama-standee-contact" />
              {e.figure_image ? (
                <span aria-hidden className="diorama-standee-reflect">
                  <img src={e.figure_image} alt="" loading="lazy" draggable={false} />
                </span>
              ) : null}
              <span className="diorama-standee-name">{e.figure_name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <span aria-hidden className="diorama-floor" />
    </div>
  );
}
