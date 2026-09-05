import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useT } from "../../i18n/index.jsx";
import {
  useApiKeys,
  useCreateApiKey,
  useMcpActivity,
  useMcpStatus,
  useRevokeApiKey,
} from "../../hooks/useMcpKeys.js";
import SettingsPanel from "./SettingsPanel.jsx";
import { Button, Checkbox, Input, Modal, Select } from "../../components/ui/index.js";

/**
 * Scope presets, in the order they're offered. `custom` is the escape hatch;
 * the others are the three shapes people actually want.
 *
 * `read` is first and is what the modal opens on: a key handed to an agent
 * should start out unable to change anything, and widening it is a deliberate
 * click.
 */
const PRESETS = {
  read: ["catalogue:read", "collection:read", "stats:read"],
  curate: [
    "catalogue:read",
    "collection:read",
    "collection:write",
    "stats:read",
  ],
  full: [
    "catalogue:read",
    "catalogue:write",
    "collection:read",
    "collection:write",
    "collection:delete",
    "stats:read",
    "social:read",
    "search:ai",
  ],
};

/** Scopes that let an agent change something. Shown with a warning marker. */
const WRITE_SCOPES = new Set([
  "catalogue:write",
  "collection:write",
  "collection:delete",
]);

const EXPIRY_CHOICES = ["", "30", "90", "365"];

function sameSet(a, b) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function fmtDate(iso, locale) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * 鍵 Accès API — per-user API keys for the MCP endpoint, plus what agents have
 * been doing with them.
 *
 * Three deliberate choices in here:
 *
 *   1. The secret is rendered exactly once, in the post-creation modal,
 *      alongside a ready-to-paste `claude mcp add` command. Nothing stores it,
 *      so there is no "show again" — the modal says so before it's dismissed.
 *   2. The create form opens on the read-only preset. Write scopes carry a
 *      warning glyph, and `collection:delete` says out loud that it is
 *      irreversible.
 *   3. The activity list is part of the panel, not a separate page. A key's
 *      value is inseparable from being able to see what it did.
 *
 * The whole panel hides when an admin has switched the endpoint off — there is
 * nothing useful to do with a key that will be refused.
 */
export default function McpPanel({ registerRef, locale = "fr" }) {
  const t = useT();
  const status = useMcpStatus();
  const keys = useApiKeys();
  const activity = useMcpActivity();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(PRESETS.read);
  const [expiry, setExpiry] = useState("");
  const [minted, setMinted] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(null);

  const allScopes = status.data?.scopes ?? [];
  const endpoint = useMemo(
    () => `${window.location.origin}${status.data?.endpoint ?? "/mcp"}`,
    [status.data],
  );

  // An admin turned it off, or we don't know yet — render nothing rather than
  // a panel whose keys can't be used.
  if (!status.data?.enabled) return null;

  const activePreset =
    Object.entries(PRESETS).find(([, v]) => sameSet(v, scopes))?.[0] ?? "custom";

  const toggleScope = (scope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const submit = async () => {
    const created = await create.mutateAsync({
      name: name.trim() || t("mcp.default_key_name"),
      scopes,
      ...(expiry ? { expires_in_days: Number(expiry) } : {}),
    });
    setMinted(created);
    setFormOpen(false);
    setName("");
    setScopes(PRESETS.read);
    setExpiry("");
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the value is selectable either way */
    }
  };

  const claudeCommand = minted
    ? `claude mcp add --transport http figurecollector ${endpoint} --header "Authorization: Bearer ${minted.token}"`
    : "";

  return (
    <SettingsPanel
      id="mcp"
      kanji="鍵"
      eyebrow={t("settings.nav.mcp")}
      title={t("mcp.title")}
      registerRef={registerRef}
    >
      <p className="text-sm leading-relaxed text-[var(--on-surface-muted)]">
        {t("mcp.intro")}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <code className="text-xs px-2 py-1 rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] break-all">
          {endpoint}
        </code>
        <Button variant="subtle" size="sm" onClick={() => copy(endpoint)}>
          <Copy size={14} aria-hidden /> {t("mcp.copy")}
        </Button>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-[var(--on-surface-muted)]">
        {t("mcp.boundaries")}
      </p>

      {/* ── The keys ── */}
      <h3 className="mt-8 mb-3 text-sm font-medium">{t("mcp.keys_heading")}</h3>

      {keys.isLoading ? (
        <p className="text-sm text-[var(--on-surface-muted)]" role="status">
          …
        </p>
      ) : (keys.data ?? []).length === 0 ? (
        <p className="text-sm text-[var(--on-surface-muted)]">{t("mcp.no_keys")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {keys.data.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-start justify-between gap-3 p-3 rounded border border-[var(--border-subtle)] bg-[var(--surface-raised)]"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium flex items-center gap-2">
                  <KeyRound size={14} aria-hidden className="text-[var(--accent)]" />
                  {k.name}
                </p>
                <p className="mt-1 text-xs text-[var(--on-surface-muted)]">
                  <code>fck_{k.prefix}…</code>
                  {" · "}
                  {k.last_used_at
                    ? t("mcp.last_used", { date: fmtDate(k.last_used_at, locale) })
                    : t("mcp.never_used")}
                  {k.expires_at
                    ? ` · ${t("mcp.expires", { date: fmtDate(k.expires_at, locale) })}`
                    : ""}
                </p>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {k.scopes.map((s) => (
                    <span
                      key={s}
                      className={`text-[0.7rem] px-1.5 py-0.5 rounded border ${
                        WRITE_SCOPES.has(s)
                          ? "border-[var(--primary)] text-[var(--primary)]"
                          : "border-[var(--border-subtle)] text-[var(--on-surface-muted)]"
                      }`}
                    >
                      {s}
                    </span>
                  ))}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRevoke(k)}
                aria-label={t("mcp.revoke_aria", { name: k.name })}
              >
                <Trash2 size={14} aria-hidden /> {t("mcp.revoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Button onClick={() => setFormOpen(true)}>{t("mcp.new_key")}</Button>
      </div>

      {/* ── Activity ── */}
      <h3 className="mt-8 mb-3 text-sm font-medium">{t("mcp.activity_heading")}</h3>
      {(activity.data ?? []).length === 0 ? (
        <p className="text-sm text-[var(--on-surface-muted)]">{t("mcp.no_activity")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[var(--on-surface-muted)] text-left">
              <tr>
                <th className="py-1.5 pr-3 font-normal">{t("mcp.col_when")}</th>
                <th className="py-1.5 pr-3 font-normal">{t("mcp.col_tool")}</th>
                <th className="py-1.5 pr-3 font-normal">{t("mcp.col_outcome")}</th>
                <th className="py-1.5 font-normal">{t("mcp.col_key")}</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.map((row, i) => (
                <tr key={`${row.at}-${i}`} className="border-t border-[var(--border-subtle)]">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--on-surface-muted)]">
                    {new Date(row.at).toLocaleString(locale)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <code>{row.tool}</code>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className={
                        row.outcome === "ok"
                          ? "text-[var(--on-surface-muted)]"
                          : "text-[var(--primary)]"
                      }
                      title={row.detail ?? undefined}
                    >
                      {t(`mcp.outcome.${row.outcome}`, { default: row.outcome })}
                    </span>
                  </td>
                  <td className="py-1.5 text-[var(--on-surface-muted)]">{row.key_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create ── */}
      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={t("mcp.new_key")}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            {t("mcp.field_name")}
            <Input
              data-autofocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("mcp.name_placeholder")}
              maxLength={80}
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm">{t("mcp.field_preset")}</span>
            <div className="flex flex-wrap gap-2">
              {["read", "curate", "full"].map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={activePreset === p ? "primary" : "ghost"}
                  onClick={() => setScopes(PRESETS[p])}
                >
                  {t(`mcp.preset.${p}`)}
                </Button>
              ))}
              {activePreset === "custom" ? (
                <span className="self-center text-xs text-[var(--on-surface-muted)]">
                  {t("mcp.preset.custom")}
                </span>
              ) : null}
            </div>
          </div>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm mb-1">{t("mcp.field_scopes")}</legend>
            {allScopes.map((s) => (
              <Checkbox
                key={s}
                checked={scopes.includes(s)}
                onChange={() => toggleScope(s)}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <code className="text-xs">{s}</code>
                    {WRITE_SCOPES.has(s) ? (
                      <AlertTriangle size={12} aria-hidden className="text-[var(--primary)]" />
                    ) : null}
                  </span>
                }
                hint={t(`mcp.scope.${s}`, { default: s })}
              />
            ))}
          </fieldset>

          <Select
            label={t("mcp.field_expiry")}
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            options={EXPIRY_CHOICES.map((d) => ({
              value: d,
              label: d ? t("mcp.expiry_days", { days: d }) : t("mcp.expiry_never"),
            }))}
          />

          {create.isError ? (
            <p className="text-sm text-[var(--primary)]" role="alert">
              {create.error?.message ?? t("mcp.error")}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFormOpen(false)}>
              {t("mcp.cancel")}
            </Button>
            <Button onClick={submit} disabled={scopes.length === 0 || create.isPending}>
              {t("mcp.create")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── The one and only sight of the secret ── */}
      <Modal open={!!minted} onClose={() => setMinted(null)} title={t("mcp.minted_title")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed">{t("mcp.minted_once")}</p>
          <div className="flex flex-col gap-2">
            <code className="text-xs p-2.5 rounded bg-[var(--surface-raised)] border border-[var(--primary)] break-all select-all">
              {minted?.token}
            </code>
            <Button size="sm" variant="subtle" onClick={() => copy(minted.token)}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{" "}
              {copied ? t("mcp.copied") : t("mcp.copy_key")}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm">{t("mcp.claude_code_hint")}</p>
            <code className="text-[0.7rem] p-2.5 rounded bg-[var(--surface-raised)] border border-[var(--border-subtle)] break-all select-all">
              {claudeCommand}
            </code>
            <Button size="sm" variant="subtle" onClick={() => copy(claudeCommand)}>
              <Copy size={14} aria-hidden /> {t("mcp.copy_command")}
            </Button>
          </div>

          <p className="text-xs leading-relaxed text-[var(--on-surface-muted)]">
            {t("mcp.oauth_note")}
          </p>

          <div className="flex justify-end">
            <Button onClick={() => setMinted(null)}>{t("mcp.minted_done")}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Revoke ── */}
      <Modal
        open={!!confirmRevoke}
        onClose={() => setConfirmRevoke(null)}
        title={t("mcp.revoke_title")}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed">
            {t("mcp.revoke_body", { name: confirmRevoke?.name })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmRevoke(null)}>
              {t("mcp.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await revoke.mutateAsync(confirmRevoke.id);
                setConfirmRevoke(null);
              }}
              disabled={revoke.isPending}
            >
              {t("mcp.revoke")}
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsPanel>
  );
}
