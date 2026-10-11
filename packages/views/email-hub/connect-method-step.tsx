"use client";

import { Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmailHubOAuthProvider, EmailHubProviders } from "@uniwork/core/types/email-hub";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { pickerCardClass } from "../common/picker-card";
import { SignInMark } from "../common/provider-icons";

const OAUTH_PROVIDERS = ["google", "microsoft"] as const satisfies readonly EmailHubOAuthProvider[];
const cardClass = cn(
  pickerCardClass(false),
  "flex items-start gap-3 px-4 py-3 active:bg-muted disabled:pointer-events-none disabled:opacity-50",
);
const cardIconClass = "mt-0.5 size-5 shrink-0";
/** An inline text button in a sentence, with a 44px hit area on touch screens. */
export const inlineLinkClass =
  "inline-flex items-center font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11";

function CardText({ title, hint }: { title: string; hint: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="text-body font-medium">{title}</span>
      <span className="text-caption text-pretty text-muted-foreground">{hint}</span>
    </span>
  );
}

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
      <SignInMark provider={provider} className={cardIconClass} />
      <CardText title={t(`email_hub.connect.method_${provider}`)} hint={t(`email_hub.connect.method_${provider}_hint`)} />
    </button>
  );
}

/** Shown while a sign-in popup is open: where to look, and a way to bring a popup hidden behind the page back. */
export function OAuthPendingStatus({ onShowWindow }: { onShowWindow: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
      <p role="status" className="flex items-center gap-2">
        <Spinner />
        {t("email_hub.connect.oauth_pending")}
      </p>
      <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={onShowWindow}>
        {t("email_hub.connect.oauth_show_window")}
      </Button>
    </div>
  );
}

/**
 * How a new mailbox connects: Google and Microsoft sign-in when the server has their client
 * (spec §5.6, Q9), then the own-domain server, then the app password as a secondary link.
 */
export function ConnectMethodStep({
  providers,
  providersLoading,
  pending,
  onPick,
  onOAuth,
}: {
  /** Undefined while loading or after a failed read: only the password ways are offered. */
  providers: EmailHubProviders | undefined;
  /** The providers read is in flight: hold the OAuth cards' place so the list does not jump. */
  providersLoading: boolean;
  /** A sign-in popup is open; every way in holds still so a second click cannot start another connect. */
  pending: boolean;
  onPick: (method: "custom" | "app_password") => void;
  onOAuth: (provider: EmailHubOAuthProvider) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {/* Same height as a one-line-hint card: py-3, a body and a caption line, the border. */}
        {providersLoading
          ? OAUTH_PROVIDERS.map((provider) => <Skeleton key={provider} className="h-16 rounded-lg" />)
          : OAUTH_PROVIDERS.filter((provider) => providers?.[provider]).map((provider) => (
              <OAuthProviderButton key={provider} provider={provider} pending={pending} onClick={() => onOAuth(provider)} />
            ))}
        <button type="button" className={cardClass} disabled={pending} onClick={() => onPick("custom")}>
          <Server aria-hidden className={cn(cardIconClass, "text-muted-foreground")} />
          <CardText title={t("email_hub.connect.method_custom")} hint={t("email_hub.connect.method_custom_hint")} />
        </button>
      </div>
      <p className="text-caption text-pretty text-muted-foreground">
        {t("email_hub.connect.method_app_password_hint")}{" "}
        <button type="button" className={inlineLinkClass} disabled={pending} onClick={() => onPick("app_password")}>
          {t("email_hub.connect.method_app_password")}
        </button>
      </p>
    </div>
  );
}
