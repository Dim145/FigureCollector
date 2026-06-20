import { Link } from "react-router-dom";
import { Avatar } from "../../components/ui/index.js";
import {
  KIND_META,
  kindAccent,
  toneColor,
  formatTimeOfDay,
  relativeShort,
} from "./journalConstants.js";

/**
 * One journal event as an editorial feed row: the actor's avatar with a small
 * kind-kanji medallion pinned to it, the typeset sentence (figure name accented
 * + linked), any slip / status-change annotation, the figure thumbnail, and a
 * clear time-of-day + relative timestamp. Hover only brightens the figure
 * name + lifts the thumbnail (opacity/transform — GPU-light, reduced-motion safe).
 *
 * `actorName` / `actorAvatar` describe whose ledger this is (the viewer's own
 * activity feed), so every row shares the same actor.
 */
export default function JournalEntry({ ev, actorName, actorAvatar, t }) {
  const meta = KIND_META[ev.kind];
  const accent = kindAccent(ev.kind);
  const time = new Date(ev.created_at);
  const figureId = ev.payload?.figure_id;
  const figureName = ev.payload?.figure_name;
  const figureImage = ev.payload?.figure_image;

  return (
    <li className="group relative flex items-start gap-3 sm:gap-4 py-4">
      {/* Actor avatar + kind medallion */}
      <span className="relative shrink-0">
        <Avatar name={actorName} src={actorAvatar} size="md" />
        <span
          aria-hidden
          title={t(`activity.kind.${ev.kind}`, { default: ev.kind })}
          className="absolute -bottom-1 -right-1 grid place-items-center w-5 h-5 rounded-full ja text-[11px] leading-none border"
          style={{
            color: accent,
            background: "var(--surface)",
            borderColor: `color-mix(in oklab, ${accent} 55%, transparent)`,
          }}
        >
          {meta?.kanji ?? "・"}
          {/* sentiment pip */}
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
            style={{ background: toneColor(meta?.tone), boxShadow: "0 0 0 1px var(--surface)" }}
          />
        </span>
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-[var(--on-surface)]">
          <EntryLine ev={ev} t={t} figureId={figureId} figureName={figureName} />
        </p>

        {ev.kind === "preorder_slipped" ? (
          <SlipTape from={ev.payload?.from_date} to={ev.payload?.to_date} t={t} />
        ) : null}
        {ev.kind === "preorder_status_changed" ? (
          <StatusChange from={ev.payload?.from_status} to={ev.payload?.to_status} t={t} />
        ) : null}

        <span className="mt-1.5 block label-mono text-[var(--on-surface-subtle)]">
          <time
            dateTime={ev.created_at}
            title={time.toLocaleString(document.documentElement.lang || undefined)}
          >
            {formatTimeOfDay(time)} · {relativeShort(time)}
          </time>
        </span>
      </div>

      {/* Figure thumbnail */}
      {figureImage ? (
        <Link
          to={figureId ? `/figures/${figureId}` : "#"}
          aria-label={figureName ?? ""}
          className="shrink-0 block w-12 h-12 overflow-hidden border border-[var(--border)] bg-[var(--surface-sunken)] transition-transform duration-[var(--dur-fast)] group-hover:-translate-y-0.5 motion-reduce:transition-none"
          style={{ borderRadius: "var(--radius-sm)" }}
        >
          <img
            src={figureImage}
            alt={figureName ?? ""}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        </Link>
      ) : null}
    </li>
  );
}

/** The typeset event sentence. The figure name is a display-serif accent,
 *  linked to the detail page when the id is known. */
function EntryLine({ ev, t, figureId, figureName }) {
  const name = (
    <strong
      className="font-normal text-[var(--accent)]"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {figureName ?? t("activity.unknown_figure")}
    </strong>
  );
  const linked = figureId ? (
    <Link
      to={`/figures/${figureId}`}
      className="underline decoration-[var(--border-strong)] hover:decoration-[var(--accent)] underline-offset-4 transition-colors"
    >
      {name}
    </Link>
  ) : (
    name
  );

  const PREFIXED = {
    owned_added: "activity.line.owned_added.prefix",
    owned_removed: "activity.line.owned_removed.prefix",
    preorder_created: "activity.line.preorder_created.prefix",
    preorder_slipped: "activity.line.preorder_slipped.prefix",
    preorder_status_changed: "activity.line.preorder_status_changed.prefix",
    preorder_received: "activity.line.preorder_received.prefix",
  };
  const prefixKey = PREFIXED[ev.kind];
  if (prefixKey) {
    return (
      <>
        {t(prefixKey)} {linked}
      </>
    );
  }
  return (
    <>
      {t("activity.event.fallback", { kind: ev.kind })}
      {figureName ? <> · {linked}</> : null}
    </>
  );
}

/** Slipped preorder — a from → to date annotation. */
function SlipTape({ from, to, t }) {
  return (
    <span
      className="mt-1.5 inline-flex items-center gap-2 text-xs px-2 py-1 border"
      aria-label={t("activity.kind.preorder_slipped", { default: "Report" })}
      style={{
        borderRadius: "var(--radius-sm)",
        borderColor: "color-mix(in oklab, var(--warning) 38%, transparent)",
        background: "color-mix(in oklab, var(--warning) 8%, transparent)",
        color: "var(--on-surface-muted)",
      }}
    >
      <span className="tabular-nums">{from ?? "?"}</span>
      <span aria-hidden className="text-[var(--warning)]">
        →
      </span>
      <span className="tabular-nums text-[var(--on-surface)]">{to ?? "?"}</span>
    </span>
  );
}

/** Status transition — two pills with an arrow between them. */
function StatusChange({ from, to, t }) {
  return (
    <span
      className="mt-1.5 inline-flex items-center gap-2 text-xs"
      aria-label={t("activity.kind.preorder_status_changed", { default: "État" })}
    >
      <Pill>{from ? t(`status.${from}`, { default: from }) : "?"}</Pill>
      <span aria-hidden className="text-[var(--on-surface-subtle)]">
        →
      </span>
      <Pill accent>{to ? t(`status.${to}`, { default: to }) : "?"}</Pill>
    </span>
  );
}

function Pill({ accent = false, children }) {
  return (
    <span
      className="px-2 py-0.5 border tabular-nums"
      style={{
        borderRadius: "var(--radius-pill)",
        borderColor: accent
          ? "color-mix(in oklab, var(--accent) 40%, transparent)"
          : "var(--border)",
        background: accent
          ? "color-mix(in oklab, var(--accent) 10%, transparent)"
          : "var(--surface-sunken)",
        color: accent ? "var(--accent)" : "var(--on-surface-muted)",
      }}
    >
      {children}
    </span>
  );
}
