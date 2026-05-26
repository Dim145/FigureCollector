// Maps server-side event_type + payload into a human-readable title /
// sub-line + an optional deep link + a kanji glyph for the row.
//
// Keeping this in one file means the bell popover, the /notifications
// page, and any future toast surface all format the same way.

const KANJI_BY_EVENT = {
  achievement_unlocked: "印",
  preorder_release_today: "予",
  preorder_release_j7: "近",
  preorder_delivery_today: "届",
  preorder_delivery_overdue: "遅",
};

export function formatNotification(n, t) {
  const p = n.payload ?? {};
  const kanji = KANJI_BY_EVENT[n.event_type] ?? "知";

  switch (n.event_type) {
    case "achievement_unlocked": {
      const code = p.code ?? "";
      const label = t(`achievements.label.${code}`, { default: code });
      const tier = p.tier ?? "bronze";
      return {
        title: t("notifications.event.achievement_unlocked.title", { label }),
        sub: t(`achievements.tier.${tier}`, { default: tier }),
        href: "/achievements",
        kanji,
      };
    }
    case "preorder_release_today": {
      return {
        title: t("notifications.event.preorder_release_today.title", {
          name: p.figure_name ?? "—",
        }),
        sub: p.release_date ?? "",
        href: p.figure_id ? `/figures/${p.figure_id}` : "/preorders",
        kanji,
      };
    }
    case "preorder_release_j7": {
      return {
        title: t("notifications.event.preorder_release_j7.title", {
          name: p.figure_name ?? "—",
        }),
        sub: t("notifications.event.preorder_release_j7.sub", {
          date: p.release_date ?? "—",
        }),
        href: p.figure_id ? `/figures/${p.figure_id}` : "/preorders",
        kanji,
      };
    }
    case "preorder_delivery_today": {
      return {
        title: t("notifications.event.preorder_delivery_today.title", {
          name: p.figure_name ?? "—",
        }),
        sub: p.delivery_date ?? "",
        href: p.figure_id ? `/figures/${p.figure_id}` : "/preorders",
        kanji,
      };
    }
    case "preorder_delivery_overdue": {
      return {
        title: t("notifications.event.preorder_delivery_overdue.title", {
          name: p.figure_name ?? "—",
        }),
        sub: t("notifications.event.preorder_delivery_overdue.sub", {
          date: p.delivery_date ?? "—",
        }),
        href: p.figure_id ? `/figures/${p.figure_id}` : "/preorders",
        kanji,
      };
    }
    default:
      return {
        title: n.event_type,
        sub: null,
        href: null,
        kanji,
      };
  }
}
