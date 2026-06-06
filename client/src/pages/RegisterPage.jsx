import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useAuthProviders, useMe, useRegister } from "../hooks/useMe.js";
import AccentTitle from "../components/AccentTitle.jsx";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import FormField from "../components/FormField.jsx";
import Halo from "../components/Halo.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";
import { mapApiError } from "../lib/errorMap.js";

/**
 * Direction A — "Vitrine privée" sign-up. Mirrors the LoginPage split: an
 * editorial brand panel (像 watermark, red-accent headline, seigaiha foot) on
 * lg+, the registration form in a noir Card beside it; brand collapses into a
 * compact header on mobile.
 */
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

  const signupClosed = providers.data?.local?.signup_enabled === false;

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
    <main className="min-h-dvh relative overflow-hidden">
      <Halo />
      <div className="absolute top-5 right-5 z-20">
        <LocaleSwitcher />
      </div>

      <div className="relative z-10 min-h-dvh grid lg:grid-cols-2 max-w-6xl mx-auto">
        {/* ─── Brand panel (lg+) ─── */}
        <aside className="relative hidden lg:flex flex-col justify-center px-14 xl:px-20 overflow-hidden">
          <span
            aria-hidden
            className="kanji-mark text-[36rem] -left-16 top-1/2 -translate-y-1/2 select-none"
          >
            蒐
          </span>
          <div className="relative">
            <Link
              to="/"
              className="group inline-flex items-baseline gap-2.5 mb-12"
              aria-label="FigureCollector — accueil"
            >
              <span className="ja text-2xl text-[var(--color-or)] leading-none transition-transform duration-500 group-hover:rotate-[6deg]">
                像
              </span>
              <span className="display text-xl text-[var(--color-ivoire)] group-hover:text-[var(--color-or-pale)] transition-colors">
                FigureCollector
              </span>
            </Link>
            <p className="micro flex items-center gap-2.5">
              <span aria-hidden className="w-1 h-1 bg-[var(--color-laque-bright)] rotate-45" />
              ARCHIVE · 蒐集 · NOUVELLE VITRINE
            </p>
            <h1 className="display text-6xl xl:text-7xl mt-5 leading-[0.95] text-[var(--color-ivoire)]">
              <AccentTitle text={t("register.hero")} />
            </h1>
            <div className="gold-rule w-24 my-8" />
            <p className="text-[var(--color-ivoire-soft)] text-lg leading-relaxed max-w-sm">
              {t("register.subtitle")}
            </p>
            <p className="ja mt-7 text-[var(--color-or-pale)]/80 tracking-[0.4em] text-sm">
              {t("app.tagline_jp")}
            </p>
          </div>
          <div
            aria-hidden
            className="seigaiha absolute inset-x-0 bottom-0 h-28 opacity-60"
            style={{ maskImage: "linear-gradient(transparent, #000)", WebkitMaskImage: "linear-gradient(transparent, #000)" }}
          />
        </aside>

        {/* ─── Form ─── */}
        <div className="flex items-center justify-center px-6 py-14">
          <Card className="relative w-full max-w-md p-8 md:p-10">
            <header className="mb-8">
              <Link to="/" className="lg:hidden inline-flex items-baseline gap-2 mb-5">
                <span className="ja text-xl text-[var(--color-or)]">像</span>
                <span className="display text-lg text-[var(--color-ivoire)]">FigureCollector</span>
              </Link>
              <p className="micro">{t("register.title")}</p>
              <h2 className="display text-3xl md:text-4xl mt-1.5 text-[var(--color-ivoire)] lg:hidden">
                <AccentTitle text={t("register.hero")} />
              </h2>
              <p className="display-italic text-[var(--color-or)] text-lg mt-1 lg:mt-2">
                {t("register.subtitle")}
              </p>
              <div className="gold-rule w-20 mt-5" />
            </header>

            {signupClosed ? (
              <p role="status" className="text-center text-[var(--color-ivoire-soft)] py-4">
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
        </div>
      </div>
    </main>
  );
}
