"use client";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { AppLink } from "../navigation";
import { AUTH_LINK } from "./auth-controls";

/**
 * The line under the sign-up and sign-in actions that makes the terms of use
 * part of the agreement (Apple 1.2, Google Play's UGC policy: users agree to
 * terms that forbid objectionable content before they can post). The phone
 * apps sign in through this same page, so the line covers them too. Both
 * pages open in the visitor's language.
 */
export function AuthLegalNote({ action }: { action: "signUp" | "signIn" }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "vi" ? "vi" : "en";
  return (
    <p className="text-pretty text-center text-caption text-muted-foreground">
      {t(`auth.legal.${action}`)}{" "}
      <AppLink href={paths.marketing(paths.terms(), locale)} className={AUTH_LINK}>
        {t("auth.legal.terms")}
      </AppLink>{" "}
      {t("auth.legal.and")}{" "}
      <AppLink href={paths.marketing(paths.privacy(), locale)} className={AUTH_LINK}>
        {t("auth.legal.privacy")}
      </AppLink>
    </p>
  );
}
