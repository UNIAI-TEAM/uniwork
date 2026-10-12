"use client";

import { useEffect, useRef } from "react";
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
// Held with aria-disabled, not disabled (CLAUDE.md a11y contract): the clicked card keeps focus and its tab stop.
const cardLayoutClass = "flex min-h-16 items-start gap-3 px-4 py-3";
const cardClass = cn(
  pickerCardClass(false),
  cardLayoutClass,
  "active:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-border aria-disabled:hover:bg-card aria-disabled:active:bg-card",
);
const cardIconClass = "mt-0.5 size-5 shrink-0";
/** An inline text button in a sentence, with a 44px hit area on touch screens. */
export const inlineLinkClass =
  "inline-flex items-center font-medium text-foreground underline underline-offset-4 hover:text-brand-subtle-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 pointer-coarse:min-h-11";

/** A card's place while the providers load: the same mark and two lines, so the list does not jump as they land. */
function CardPlaceholder() {
  return (
    <div data-oauth-placeholder="" aria-hidden className={cn(cardLayoutClass, "rounded-lg border border-border")}>
      <Skeleton className={cn(cardIconClass, "rounded-full")} />
      <span className="grid flex-1 gap-1.5 pt-0.5">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3.5 w-4/5" />
      </span>
    </div>
  );
}

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
    <button
      type="button"
      className={cardClass}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={() => {
        if (!pending) onClick();
      }}
    >
      <SignInMark provider={provider} className={cardIconClass} />
      <CardText title={t(`email_hub.connect.method_${provider}`)} hint={t(`email_hub.connect.method_${provider}_hint`)} />
    </button>
  );
}

/** Shown while a sign-in popup is open: where to look, and a way to bring a popup hidden behind the page back. */
export function OAuthPendingStatus({ onShowWindow }: { onShowWindow: () => void }) {
  const { t } = useTranslation();
  const showRef = useRef<HTMLButtonElement>(null);
  // The ways in are held; the one thing left to do here is bring the popup back.
  useEffect(() => showRef.current?.focus(), []);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
      <p role="status" className="flex items-center gap-2">
        <Spinner />
        {t("email_hub.connect.oauth_pending")}
      </p>
      <Button ref={showRef} type="button" variant="link" size="sm" className="h-auto px-0" onClick={onShowWindow}>
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
        {providersLoading
          ? OAUTH_PROVIDERS.map((provider) => <CardPlaceholder key={provider} />)
          : OAUTH_PROVIDERS.filter((provider) => providers?.[provider]).map((provider) => (
              <OAuthProviderButton key={provider} provider={provider} pending={pending} onClick={() => onOAuth(provider)} />
            ))}
        <button type="button" className={cardClass} aria-disabled={pending || undefined} onClick={() => !pending && onPick("custom")}>
          <Server aria-hidden className={cn(cardIconClass, "text-muted-foreground")} />
          <CardText title={t("email_hub.connect.method_custom")} hint={t("email_hub.connect.method_custom_hint")} />
        </button>
      </div>
      <p className="text-caption text-pretty text-muted-foreground">
        {t("email_hub.connect.method_app_password_hint")}{" "}
        <button
          type="button"
          className={inlineLinkClass}
          aria-disabled={pending || undefined}
          onClick={() => !pending && onPick("app_password")}
        >
          {t("email_hub.connect.method_app_password")}
        </button>
      </p>
    </div>
  );
}
