import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFollowers, useFollowing } from "../hooks/useFollow.js";
import FollowButton from "./FollowButton.jsx";

/**
 * "Le carnet de liens" (Lot 4) — a two-tab modal listing a profile's
 * followers and the accounts it follows. Each row carries the follow action
 * and a mutual badge; rows link to public vitrines. Reached from the
 * clickable counters on the public profile.
 */
export default function FollowListModal({
  open,
  slug,
  initialTab = "followers",
  counts,
  onClose,
}) {
  const t = useT();
  const me = useMe();
  const cardRef = useRef(null);
  const [tab, setTab] = useState(initialTab);
  useFocusTrap(cardRef, { active: open, onClose });

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const followers = useFollowers(slug, open && tab === "followers");
  const following = useFollowing(slug, open && tab === "following");
  const active = tab === "followers" ? followers : following;
  const myUsername = me.data?.user?.username;

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const rows = active.data ?? [];

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("follow.lists.title")}
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-[var(--color-noir)]/90 backdrop-blur-sm p-6"
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[40rem] max-h-[80vh] flex flex-col bg-[var(--color-noir-soft)] border border-[color-mix(in_oklab,var(--color-or)_22%,transparent)] shadow-[0_30px_60px_-30px_rgba(0,0,0,.8)]"
      >
        {/* tabs */}
        <div className="flex border-b border-[color-mix(in_oklab,var(--color-or)_18%,transparent)]">
          <Tab
            on={tab === "followers"}
            onClick={() => setTab("followers")}
            label={t("follow.tab.followers")}
            count={counts?.followers}
          />
          <Tab
            on={tab === "following"}
            onClick={() => setTab("following")}
            label={t("follow.tab.following")}
            count={counts?.following}
          />
        </div>

        {/* list */}
        <div className="overflow-y-auto">
          {active.isLoading ? (
            <p className="py-10 text-center text-[var(--color-ivoire-soft)]">…</p>
          ) : rows.length === 0 ? (
            <div className="py-10 px-6 text-center text-[var(--color-ivoire-soft)] text-[13px]">
              <p>
                {tab === "followers"
                  ? t("follow.empty.followers")
                  : t("follow.empty.following")}
              </p>
              <Link
                to="/collectionneurs"
                onClick={onClose}
                className="inline-block mt-3 text-[var(--color-or-pale)] border-b border-[color-mix(in_oklab,var(--color-or)_35%,transparent)]"
              >
                {t("nav.discover")} →
              </Link>
            </div>
          ) : (
            <ul>
              {rows.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  isSelf={r.username === myUsername}
                  onClose={onClose}
                  t={t}
                />
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={t("editor.cancel")}
          className="absolute -top-3 -right-3 w-8 h-8 grid place-items-center rounded-full bg-[var(--color-noir-soft)] border border-[color-mix(in_oklab,var(--color-or)_35%,transparent)] text-[var(--color-ivoire-soft)] hover:text-[var(--color-ivoire)]"
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Tab({ on, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-[0.95rem] px-2 text-[11px] tracking-[0.18em] uppercase border-b-2 ${
        on
          ? "text-[var(--color-or-pale)] border-[var(--color-or)]"
          : "text-[var(--color-ivoire-soft)] border-transparent"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className="display text-[1.05rem] ml-[0.45em] text-[var(--color-ivoire)]">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Row({ r, isSelf, onClose, t }) {
  const initial = [...(r.display_name || r.username || "?")][0];
  const mutual = r.is_following && r.follows_viewer;
  const NameTag = r.is_public ? Link : "span";
  const nameProps = r.is_public ? { to: `/u/${r.username}`, onClick: onClose } : {};

  return (
    <li className="grid grid-cols-[auto_1fr_auto_auto] gap-[0.95rem] items-center px-[1.15rem] py-[0.85rem] border-b border-[color-mix(in_oklab,var(--color-or)_10%,transparent)] last:border-b-0">
      <span className="fc-seal fc-seal--sm" aria-hidden>
        {initial}
      </span>
      <div className="min-w-0">
        <NameTag
          {...nameProps}
          className={`display text-[1.2rem] leading-[1.05] text-[var(--color-ivoire)] ${r.is_public ? "hover:text-[var(--color-or-pale)]" : ""}`}
        >
          {r.display_name}
          {mutual ? (
            <span className="fc-chip fc-chip--jade ml-2 align-middle text-[8.5px] tracking-[0.1em]">
              {t("follow.mutual")}
            </span>
          ) : null}
        </NameTag>
        <div className="ja text-[10.5px] tracking-[0.06em] text-[var(--color-or-pale)] mt-[0.1rem]">
          @{r.username}
        </div>
      </div>
      <span className="font-[var(--font-mono)] text-[11px] text-[var(--color-ivoire-soft)] whitespace-nowrap hidden sm:block">
        {t("collector.pieces_n", { n: r.pieces })}
      </span>
      {isSelf ? (
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-or-pale)]/60">
          {t("follow.you")}
        </span>
      ) : (
        <FollowButton username={r.username} isFollowing={r.is_following} compact />
      )}
    </li>
  );
}
