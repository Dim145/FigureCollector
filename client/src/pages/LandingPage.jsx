import { Link } from "react-router-dom";
import { useT } from "../i18n/index.jsx";
import { useLogout, useMe } from "../hooks/useMe.js";
import Button from "../components/Button.jsx";
import Halo from "../components/Halo.jsx";
import LocaleSwitcher from "../components/LocaleSwitcher.jsx";

export default function LandingPage() {
  const t = useT();
  const me = useMe();
  const logout = useLogout();

  const authed = me.data?.authenticated;
  const user = me.data?.user;

  return (
    <main className="min-h-dvh grid place-items-center px-6 py-16 relative overflow-hidden">
      <Halo />

      <div className="absolute top-6 right-6 z-10">
        <LocaleSwitcher />
      </div>

      <section className="relative max-w-xl text-center">
        <p className="micro">{t("app.phase")}</p>

        <h1 className="display text-7xl md:text-8xl leading-none mt-6 text-[var(--color-ivoire)]">
          {t("app.name")}
        </h1>

        <p className="ja text-lg mt-5 text-[var(--color-or-pale)] tracking-[0.4em]">
          {t("app.tagline_jp")}
        </p>

        <div className="gold-rule mx-auto w-48 my-10" />

        <p className="display-italic text-2xl text-[var(--color-or)] leading-snug">
          {t("app.tagline_en")}
        </p>

        <p className="mt-8 text-sm text-[var(--color-ivoire-soft)] leading-relaxed">
          {t("landing.bootstrap_note")}
        </p>

        <div className="gold-rule mx-auto w-48 my-10" />

        {authed ? (
          <div className="space-y-4">
            <p className="display text-2xl text-[var(--color-ivoire)]">
              {t("landing.greeting", { name: user.display_name })}
            </p>
            <p className="micro">{t("landing.welcome_back")}</p>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              <Link to="/collection">
                <Button variant="primary">{t("nav.collection")}</Button>
              </Link>
              <Link to="/preorders">
                <Button variant="ghost">{t("nav.preorders")}</Button>
              </Link>
              <Button
                variant="ghost"
                onClick={() => logout.mutate()}
                loading={logout.isPending}
              >
                {t("nav.signout")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 justify-center">
            <Link to="/login">
              <Button variant="primary">{t("landing.cta_signin")}</Button>
            </Link>
            <Link to="/register">
              <Button variant="ghost">{t("landing.cta_signup")}</Button>
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
