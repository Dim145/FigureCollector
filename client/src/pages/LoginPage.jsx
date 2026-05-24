import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useAuthProviders, useLogin, useMe } from "../hooks/useMe.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";
import Halo from "../components/Halo.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";
import { mapApiError } from "../lib/errorMap.js";

export default function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useMe();
  const providers = useAuthProviders();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  if (me.data?.authenticated) return <Navigate to="/" replace />;

  const onSubmit = (e) => {
    e.preventDefault();
    login.mutate(
      { username: username.trim(), password },
      { onSuccess: () => navigate("/") },
    );
  };

  const errorMessage = login.error ? mapApiError(login.error, t) : null;
  const oidcProviders = providers.data?.oidc ?? [];

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-16 relative overflow-hidden">
      <Halo />
      <div className="absolute top-6 right-6 z-10">
        <LocaleSwitcher />
      </div>

      <Card className="relative w-full max-w-md p-8 md:p-10">
        <header className="text-center mb-8">
          <p className="micro">{t("app.name")}</p>
          <h1 className="display text-4xl md:text-5xl mt-2 text-[var(--color-ivoire)]">
            {t("login.title")}
          </h1>
          <p className="display-italic mt-1 text-[var(--color-or)] text-lg">
            {t("login.subtitle")}
          </p>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        {oidcProviders.length > 0 ? (
          <>
            <div className="space-y-3 mb-6">
              {oidcProviders.map((p) => (
                <OidcButton key={p.id} provider={p} t={t} />
              ))}
            </div>
            <div className="flex items-center gap-3 my-6">
              <span className="flex-1 h-px bg-[var(--color-or)]/20" />
              <span className="micro text-[var(--color-ivoire-soft)]">
                {t("login.or_local")}
              </span>
              <span className="flex-1 h-px bg-[var(--color-or)]/20" />
            </div>
          </>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-5">
          <FormField
            label={t("login.field.username")}
            value={username}
            onChange={setUsername}
            autoComplete="username"
            required
            disabled={login.isPending}
          />
          <FormField
            label={t("login.field.password")}
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            disabled={login.isPending}
          />

          {errorMessage ? (
            <p
              role="alert"
              className="text-sm text-[var(--color-laque-bright)] tracking-wide border-l-2 border-[var(--color-laque-bright)] pl-3 py-1"
            >
              {errorMessage}
            </p>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            loading={login.isPending}
            className="w-full"
          >
            {t("login.submit")}
          </Button>
        </form>

        <div className="gold-rule mx-auto w-32 my-8" />

        <p className="text-center text-sm text-[var(--color-ivoire-soft)]">
          {t("login.no_account")}{" "}
          <Link
            to="/register"
            className="text-[var(--color-or)] hover:text-[var(--color-or-pale)] underline-offset-4 hover:underline"
          >
            {t("login.register_link")}
          </Link>
        </p>
      </Card>
    </main>
  );
}

function OidcButton({ provider, t }) {
  // Full-page navigation so the IdP can set cookies & we land back on /api/auth/callback/...
  const onClick = () => {
    window.location.href = `/api/auth/login/${provider.id}`;
  };
  return (
    <Button variant="ghost" onClick={onClick} className="w-full">
      <OidcMark provider={provider.id} />
      {t("login.oidc_continue", { provider: provider.display_name })}
    </Button>
  );
}

/** Minimal inline SVG marks for known providers; falls back to a gold dot. */
function OidcMark({ provider }) {
  switch (provider) {
    case "google":
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.12a6.61 6.61 0 0 1 0-4.24V7.04H2.18a11 11 0 0 0 0 9.92l3.66-2.84z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.46 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84c.87-2.6 3.3-4.5 6.16-4.5z"
            fill="#EA4335"
          />
        </svg>
      );
    default:
      return (
        <span
          aria-hidden
          className="inline-block w-2 h-2 rotate-45 bg-[var(--color-or)]"
        />
      );
  }
}
