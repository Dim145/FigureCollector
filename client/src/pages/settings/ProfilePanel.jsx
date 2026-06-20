import { useState } from "react";
import { useT } from "../../i18n/index.jsx";
import { useUpdateProfile } from "../../hooks/useProfile.js";
import SettingsPanel from "./SettingsPanel.jsx";
import Avatar from "../../components/ui/Avatar.jsx";
import Badge from "../../components/ui/Badge.jsx";
import Button from "../../components/Button.jsx";
import FormField from "../../components/FormField.jsx";
import Input from "../../components/ui/Input.jsx";

/**
 * 公 Profil — the account identity card: avatar + handle + email + role, plus
 * the one genuinely-editable account field (display name, saved through the
 * existing `useUpdateProfile` mutation — the panel owns its own save). Read-only
 * identity fields (username, email, member-since) sit in a quiet definition row
 * beneath. No global CTA: this panel saves itself.
 */
export default function ProfilePanel({ user, registerRef }) {
  const t = useT();
  const update = useUpdateProfile();

  const serverName = update.data?.display_name ?? user.display_name ?? "";
  const [name, setName] = useState(serverName);
  // Re-seed the field when the server value changes underneath us (e.g. after a
  // save settles or the profile is refetched). The render-phase "adjust state
  // when a prop changes" pattern — no effect, no cascading render warning.
  const [seededFrom, setSeededFrom] = useState(serverName);
  if (seededFrom !== serverName) {
    setSeededFrom(serverName);
    setName(serverName);
  }

  const dirty = name.trim() !== (serverName ?? "").trim();
  const save = () => {
    const next = name.trim();
    if (!next || !dirty) return;
    update.mutate({ display_name: next });
  };

  const memberSince = user.member_since ?? user.created_at ?? null;

  return (
    <SettingsPanel
      id="profile"
      kanji="公"
      eyebrow={t("settings.nav.profile")}
      title={t("settings.profile.title", { default: "Profil" })}
      registerRef={registerRef}
    >
      <div className="flex items-center gap-4">
        <Avatar src={user.avatar_url} name={user.display_name || user.username} size="lg" />
        <div className="min-w-0">
          <p className="display text-xl text-[var(--on-surface)] leading-tight truncate">
            {user.display_name || user.username}
          </p>
          <p className="text-sm text-[var(--on-surface-muted)] truncate">@{user.username}</p>
        </div>
        {user.is_admin ? (
          <Badge tone="gold" className="ml-auto shrink-0">
            {t("settings.profile.role.admin", { default: "Administrateur" })}
          </Badge>
        ) : null}
      </div>

      <form
        className="mt-6 flex items-end gap-3 flex-wrap"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <FormField
          label={t("settings.profile.display_name", { default: "Nom affiché" })}
          className="flex-1 min-w-[14rem]"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            maxLength={80}
          />
        </FormField>
        <Button type="submit" disabled={!dirty || !name.trim()} loading={update.isPending}>
          {t("settings.profile.save", { default: "Enregistrer" })}
        </Button>
      </form>

      <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Row label={t("settings.profile.username", { default: "Identifiant" })}>
          @{user.username}
        </Row>
        {user.email ? (
          <Row label={t("settings.profile.email", { default: "Adresse e-mail" })}>{user.email}</Row>
        ) : null}
        {memberSince ? (
          <Row label={t("settings.profile.member_since", { default: "Membre depuis" })}>
            {formatDate(memberSince, t)}
          </Row>
        ) : null}
      </dl>
    </SettingsPanel>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-[var(--border-subtle)] pl-3">
      <dt className="micro">{label}</dt>
      <dd className="text-[var(--on-surface)] truncate">{children}</dd>
    </div>
  );
}

function formatDate(value, t) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "long",
    }).format(d);
  } catch {
    return t("settings.profile.member_since.fallback", { default: "—" });
  }
}
