import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "./ui/index.js";
import { useT } from "../i18n/index.jsx";
import { useMe } from "../hooks/useMe.js";
import { useFollowers, useFollowing } from "../hooks/useFollow.js";
import FollowButton from "./FollowButton.jsx";

/**
 * "Le carnet de liens" (Lot 4) — a two-tab modal listing a profile's
 * followers and the accounts it follows. Each row carries the follow action
 * and a mutual badge; rows link to public vitrines. Reached from the
 * clickable counters on the public profile.
 *
 * Composes the shared <Modal> (focus-trap, Esc, scroll-lock, scrim, close
 * button) so it no longer hand-rolls a portal + keydown listener.
 */
export default function FollowListModal({ open, slug, initialTab = "followers", counts, onClose }) {
  const t = useT();
  const me = useMe();
  const [tab, setTab] = useState(initialTab);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const followers = useFollowers(slug, open && tab === "followers");
  const following = useFollowing(slug, open && tab === "following");
  const active = tab === "followers" ? followers : following;
  const myUsername = me.data?.user?.username;

  const rows = active.data ?? [];

  return (
    <Modal open={open} onClose={onClose} title={t("follow.lists.title")} size="lg">
      {/* tabs */}
      <div className="flex border-b border-[var(--border-subtle)] -mt-2">
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
      <div className="max-h-[60vh] overflow-y-auto">
        {active.isLoading ? (
          <p className="py-10 text-center text-[var(--on-surface-muted)]">…</p>
        ) : rows.length === 0 ? (
          <div className="py-10 px-6 text-center text-[var(--on-surface-muted)] text-[13px]">
            <p>{tab === "followers" ? t("follow.empty.followers") : t("follow.empty.following")}</p>
            <Link
              to="/community"
              onClick={onClose}
              className="inline-block mt-3 text-[var(--accent)] border-b border-[var(--border-strong)]"
            >
              {t("nav.discover")} →
            </Link>
          </div>
        ) : (
          <ul>
            {rows.map((r) => (
              <Row key={r.id} r={r} isSelf={r.username === myUsername} onClose={onClose} t={t} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function Tab({ on, onClick, label, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-[0.95rem] px-2 text-[11px] tracking-[0.18em] uppercase border-b-2 ${
        on
          ? "text-[var(--accent)] border-[var(--accent)]"
          : "text-[var(--on-surface-muted)] border-transparent"
      }`}
    >
      {label}
      {typeof count === "number" ? (
        <span className="display text-[1.05rem] ml-[0.45em] text-[var(--on-surface)]">{count}</span>
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
    <li className="grid grid-cols-[auto_1fr_auto_auto] gap-[0.95rem] items-center px-[1.15rem] py-[0.85rem] border-b border-[var(--border-subtle)] last:border-b-0">
      <span className="fc-seal fc-seal--sm" aria-hidden>
        {initial}
      </span>
      <div className="min-w-0">
        <NameTag
          {...nameProps}
          className={`display text-[1.2rem] leading-[1.05] text-[var(--on-surface)] ${r.is_public ? "hover:text-[var(--accent)]" : ""}`}
        >
          {r.display_name}
          {mutual ? (
            <span className="fc-chip fc-chip--jade ml-2 align-middle text-[8.5px] tracking-[0.1em]">
              {t("follow.mutual")}
            </span>
          ) : null}
        </NameTag>
        <div className="ja text-[10.5px] tracking-[0.06em] text-[var(--accent)] mt-[0.1rem]">
          @{r.username}
        </div>
      </div>
      <span className="font-[var(--font-mono)] text-[11px] text-[var(--on-surface-muted)] whitespace-nowrap hidden sm:block">
        {t("collector.pieces_n", { n: r.pieces })}
      </span>
      {isSelf ? (
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--on-surface-subtle)]">
          {t("follow.you")}
        </span>
      ) : (
        <FollowButton username={r.username} isFollowing={r.is_following} compact />
      )}
    </li>
  );
}
