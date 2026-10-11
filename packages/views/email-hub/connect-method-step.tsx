"use client";

import { useTranslation } from "react-i18next";
import type { EmailHubOAuthProvider, EmailHubProviders } from "@uniwork/core/types/email-hub";
import { cn } from "@uniwork/ui/lib/utils";
import { pickerCardClass } from "../common/picker-card";

const OAUTH_PROVIDERS = ["google", "microsoft"] as const satisfies readonly EmailHubOAuthProvider[];
const cardClass = cn(pickerCardClass(false), "grid gap-0.5 px-4 py-3 disabled:pointer-events-none disabled:opacity-50");

/** One sign-in card: the method step lists one per enabled provider; an OAuth reconnect shows only its own. */
export function OAuthProviderButton({
  provider,
  pending,
  onClick,
}: {
  provider: EmailHubOAuthProvider;
  pending: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button type="button" className={cardClass} disabled={pending} aria-busy={pending || undefined} onClick={onClick}>
      <span className="text-body font-medium">{t(`email_hub.connect.method_${provider}`)}</span>
      <span className="text-caption text-pretty text-muted-foreground">{t(`email_hub.connect.method_${provider}_hint`)}</span>
    </button>
  );
}

/**
 * How a new mailbox connects: Google and Microsoft sign-in when the server has their client
 * (spec §5.6, Q9), then the own-domain server, then the app password as a secondary link.
 */
export function ConnectMethodStep({
  providers,
  pending,
  onPick,
  onOAuth,
}: {
  /** Undefined while loading or after a failed read: only the password ways are offered. */
  providers: EmailHubProviders | undefined;
  /** A sign-in popup is open; its cards hold still so a second click cannot open another. */
  pending: boolean;
  onPick: (method: "custom" | "app_password") => void;
  onOAuth: (provider: EmailHubOAuthProvider) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {OAUTH_PROVIDERS.filter((provider) => providers?.[provider]).map((provider) => (
          <OAuthProviderButton key={provider} provider={provider} pending={pending} onClick={() => onOAuth(provider)} />
        ))}
        <button type="button" className={cardClass} onClick={() => onPick("custom")}>
          <span className="text-body font-medium">{t("email_hub.connect.method_custom")}</span>
          <span className="text-caption text-pretty text-muted-foreground">{t("email_hub.connect.method_custom_hint")}</span>
        </button>
      </div>
      <p className="text-caption text-pretty text-muted-foreground">
        {t("email_hub.connect.method_app_password_hint")}{" "}
        <button
          type="button"
          className="font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground"
          onClick={() => onPick("app_password")}
        >
          {t("email_hub.connect.method_app_password")}
        </button>
      </p>
    </div>
  );
}
