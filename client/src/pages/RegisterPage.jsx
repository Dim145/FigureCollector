import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useAuthProviders, useMe, useRegister } from "../hooks/useMe.js";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";
import Halo from "../components/Halo.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";
import { mapApiError } from "../lib/errorMap.js";

export default function RegisterPage() {
  const t = useT();
  const navigate = useNavigate();
  const me = useMe();
  const providers = useAuthProviders();
  const register = useRegister();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");

  if (me.data?.authenticated) return <Navigate to="/" replace />;

  const signupClosed =
    providers.data?.local?.signup_enabled === false;

  const onSubmit = (e) => {
    e.preventDefault();
    register.mutate(
      {
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        display_name: displayName.trim() || undefined,
      },
      { onSuccess: () => navigate("/") },
    );
  };

  const errorMessage = register.error ? mapApiError(register.error, t) : null;

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
            {t("register.title")}
          </h1>
          <p className="display-italic mt-1 text-[var(--color-or)] text-lg">
            {t("register.subtitle")}
          </p>
          <div className="gold-rule mx-auto w-32 mt-6" />
        </header>

        {signupClosed ? (
          <p role="status" className="text-center text-[var(--color-ivoire-soft)]">
            {t("register.disabled")}
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <FormField
              label={t("register.field.username")}
              hint={t("register.field.username_hint")}
              value={username}
              onChange={setUsername}
              autoComplete="username"
              required
              disabled={register.isPending}
            />
            <FormField
              label={t("register.field.password")}
              hint={t("register.field.password_hint")}
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              required
              disabled={register.isPending}
            />
            <FormField
              label={t("register.field.email")}
              type="email"
              value={email}
              onChange={setEmail}
              autoComplete="email"
              disabled={register.isPending}
            />
            <FormField
              label={t("register.field.display_name")}
              value={displayName}
              onChange={setDisplayName}
              autoComplete="nickname"
              disabled={register.isPending}
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
              loading={register.isPending}
              className="w-full"
            >
              {t("register.submit")}
            </Button>
          </form>
        )}

        <div className="gold-rule mx-auto w-32 my-8" />

        <p className="text-center text-sm text-[var(--color-ivoire-soft)]">
          {t("register.have_account")}{" "}
          <Link
            to="/login"
            className="text-[var(--color-or)] hover:text-[var(--color-or-pale)] underline-offset-4 hover:underline"
          >
            {t("register.login_link")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
