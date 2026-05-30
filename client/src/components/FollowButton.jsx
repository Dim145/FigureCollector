import { useEffect, useState } from "react";
import { useT } from "../i18n/index.jsx";
import { useFollow, useUnfollow } from "../hooks/useFollow.js";

/**
 * The "affix your seal" action, reused on discovery cards, the public profile,
 * and follow-list rows. Two states:
 *   - not following → gold "＋ Suivre"
 *   - following     → jade "✓ Suivi", which reveals a red "✕ Ne plus suivre"
 *                     on hover (the destructive intent only shows on intent)
 *
 * Optimistic: flips instantly, reverts on error. The shared mutation
 * invalidates the relationship/count queries so counters refresh.
 *
 * `compact` drops the label (icon only) for dense list rows. `onChange`
 * receives the server `{ is_following, followers }` so a parent can update a
 * live count without a refetch.
 */
export default function FollowButton({
  username,
  isFollowing,
  compact = false,
  onChange,
}) {
  const t = useT();
  const follow = useFollow();
  const unfollow = useUnfollow();
  const [on, setOn] = useState(!!isFollowing);

  // Keep in sync when the source query refetches (e.g. after invalidation).
  useEffect(() => setOn(!!isFollowing), [isFollowing]);

  const pending = follow.isPending || unfollow.isPending;

  const click = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = !on;
    setOn(next); // optimistic
    const mut = next ? follow : unfollow;
    mut.mutate(username, {
      onSuccess: (data) => onChange?.(data),
      onError: () => setOn(!next), // revert
    });
  };

  if (on) {
    return (
      <button
        type="button"
        onClick={click}
        disabled={pending}
        aria-pressed="true"
        className="fc-follow fc-follow--on"
        title={t("follow.unfollow")}
      >
        <span className="fc-on">✓{compact ? "" : ` ${t("follow.following")}`}</span>
        <span className="fc-off">✕{compact ? "" : ` ${t("follow.unfollow")}`}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={click}
      disabled={pending}
      aria-pressed="false"
      className="fc-follow fc-follow--off"
    >
      ＋{compact ? "" : ` ${t("follow.follow")}`}
    </button>
  );
}
