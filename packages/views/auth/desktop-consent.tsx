"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Monitor, Smartphone } from "lucide-react";
import type { DesktopConsent } from "@uniwork/core/api/endpoints/auth";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AUTH_PILL } from "./auth-controls";
import { AuthShell } from "./auth-shell";

export type DesktopConsentState = "pending" | "approved" | "cancelled" | "error" | "expired";

type DesktopConsentProps = {
  /** Null while the attempt is still loading (state pending), or when it could not be read. */
  consent: DesktopConsent | null;
  state?: DesktopConsentState;
  callbackUrl?: string;
  onDecision: (decision: "approve" | "cancel") => Promise<void>;
  onRetry?: () => void;
  onOpenDesktop?: () => void;
  /** "Không phải bạn?": signs this browser out; the page then sends it to sign in again. */
  onSwitchAccount?: () => Promise<void>;
};

// Server client ids (DESKTOP_AUTH_CLIENTS) to the product name the person installed; anything else shows the raw id.
function appName(clientId: string | undefined): string {
  if (!clientId) return "UniWork";
  if (clientId.startsWith("uniwork-office")) return "UniWork Office";
  if (clientId.startsWith("uniwork-chat-")) return "UniChat";
  return clientId;
}

/**
 * The phone app signs in through this page too (spec §3.5): its attempt
 * carries the OS it runs on, and the page says "on this phone" instead of
 * speaking of a desktop app the person does not have.
 */
function onPhone(platform: string | undefined): boolean {
  const os = platform?.trim().toLowerCase();
  return os === "ios" || os === "android";
}

/** One fact on the plane: what it is on the left, its value on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-caption text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-body font-medium text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const PLANE = "flex flex-col divide-y divide-border/70 rounded-xl bg-muted/50 px-4 py-1";

/**
 * An address with a break chance after its @: the value column is narrow on
 * a phone, and without one a long address was cut wherever it ran out
 * ("…@example.c / om") instead of before its domain.
 */
function breakableEmail(email: string): ReactNode {
  const at = email.lastIndexOf("@");
  if (at <= 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

/**
 * Who is asking and for whom: the app, the device and the account this
 * browser is signed in as lead, because those are what the person checks
 * before allowing. The server and build only matter when something looks
 * wrong, so they wait behind "Chi tiết".
 */
function ConsentFacts({ consent, app, phone }: { consent: DesktopConsent; app: string; phone: boolean }) {
  const { t } = useTranslation();
  const Device = phone ? Smartphone : Monitor;
  return (
    <div className="flex flex-col gap-3">
      <dl className={PLANE}>
        <Fact label={t("auth.desktop.app")}>{app}</Fact>
        <Fact label={t("auth.desktop.device")}>
          <span className="inline-flex items-center gap-2">
            <Device aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            {consent.device_label || consent.platform}
          </span>
        </Fact>
        <Fact label={t("auth.desktop.account")}>
          <span className="block">{consent.account_name || t("auth.desktop.accountUnknown")}</span>
          <span className="block text-caption font-normal text-muted-foreground">
            {consent.account_email ? breakableEmail(consent.account_email) : t("auth.desktop.emailUnknown")}
          </span>
        </Fact>
      </dl>
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1.5 self-start rounded-md text-label font-medium text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11">
          <ChevronDown
            aria-hidden
            className="size-4 transition-transform duration-(--duration-fast) group-data-panel-open:rotate-180 motion-reduce:transition-none"
          />
          {t("auth.desktop.details")}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <dl className={cn(PLANE, "mt-2")}>
            <Fact label={t("auth.desktop.deployment")}>{consent.deployment_id}</Fact>
            <Fact label={t("auth.desktop.build")}>{consent.build || t("auth.desktop.unknown")}</Fact>
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** The consent's own shape while the attempt loads, so nothing moves when it lands. */
function ConsentSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className={PLANE}>
          <div className="flex h-11 items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
          <div className="flex h-11 items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex h-16 items-center justify-between gap-4">
            <Skeleton className="h-3.5 w-16" />
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </div>
        </div>
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full rounded-full" />
        <Skeleton className="h-12 w-full rounded-full" />
        <Skeleton className="h-5 w-48 self-center" />
      </div>
    </div>
  );
}

/**
 * The browser half of a desktop or phone app's sign-in: the app opened this
 * page with an attempt, and the person signed in here allows it, or not. On
 * the sign-in screens' own shell, since the person usually arrives straight
 * from /login and the two should read as one flow.
 *
 * Every outcome is final for this attempt: allowed, cancelled and expired
 * point back to the app, which starts a new one if needed; only a failure to
 * read or send offers to try again here. Each is titled by what happened.
 * The attempt last read keeps naming the app and the platform when a retry
 * or a 410 brings no attempt with it; one never read is spoken of neutrally
 * ("Quay lại ứng dụng…"), never as a guessed product on a guessed device.
 */
export function DesktopConsentView({
  consent,
  state = "pending",
  callbackUrl,
  onDecision,
  onRetry = () => undefined,
  onOpenDesktop = () => undefined,
  onSwitchAccount,
}: DesktopConsentProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<"approve" | "cancel" | null>(null);
  const [switching, setSwitching] = useState(false);
  const busy = pending !== null || switching;
  const [known, setKnown] = useState<DesktopConsent | null>(consent);
  useEffect(() => {
    if (consent) setKnown(consent);
  }, [consent]);
  const seen = consent ?? known;

  async function decide(decision: "approve" | "cancel") {
    // aria-disabled keeps the buttons in the tab order, so the guard is here.
    if (busy) return;
    setPending(decision);
    try {
      await onDecision(decision);
    } finally {
      setPending(null);
    }
  }

  async function switchAccount() {
    if (busy || !onSwitchAccount) return;
    setSwitching(true);
    try {
      await onSwitchAccount();
    } finally {
      setSwitching(false);
    }
  }

  const app = appName(seen?.client_id);
  const phone = onPhone(seen?.platform);
  const copy = phone ? "auth.desktop.phone" : "auth.desktop";

  if (state === "pending" && !consent) {
    return (
      <AuthShell>
        <ConsentSkeleton />
      </AuthShell>
    );
  }

  if (state !== "pending") {
    // Allowed and cancelled are only ever reached with the attempt read.
    const [title, result] =
      state === "approved"
        ? [t("auth.desktop.approvedTitle", { app }), t("auth.desktop.approved", { app })]
        : state === "cancelled"
          ? [t("auth.desktop.cancelledTitle"), t("auth.desktop.cancelled", { app })]
          : state === "expired"
            ? [t("auth.desktop.expiredTitle"), seen ? t("auth.desktop.expired", { app }) : t("auth.desktop.expiredUnknown")]
            : [t("auth.desktop.errorTitle"), t("auth.desktop.error")];
    return (
      <AuthShell title={title} description={<span role="status">{result}</span>}>
        {state === "error" ? (
          <Button type="button" size="lg" className={AUTH_PILL} onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            {state === "approved" && callbackUrl ? (
              <Button type="button" size="lg" className={AUTH_PILL} onClick={onOpenDesktop}>
                {t("auth.desktop.openDesktop", { app })}
              </Button>
            ) : null}
            {/* A desktop browser's tab; the phone's sign-in sheet has none. */}
            {seen && !phone ? (
              <p className="text-pretty text-caption text-muted-foreground">{t("auth.desktop.closeTab")}</p>
            ) : null}
          </div>
        )}
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t(`${copy}.title`, { app })} description={t("auth.desktop.description")} nameInTitle>
      <div className="flex flex-col gap-6">
        {consent ? <ConsentFacts consent={consent} app={app} phone={phone} /> : null}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            size="lg"
            className={AUTH_PILL}
            aria-disabled={busy || undefined}
            aria-busy={pending === "approve" || undefined}
            onClick={() => void decide("approve")}
          >
            {/* Decorative: the label already says it is working. */}
            {pending === "approve" ? <Spinner /> : null}
            {pending === "approve"
              ? t("auth.desktop.approving")
              : phone
                ? t("auth.desktop.phone.approve", { app })
                : t("auth.desktop.approve")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={AUTH_PILL}
            aria-disabled={busy || undefined}
            aria-busy={pending === "cancel" || undefined}
            onClick={() => void decide("cancel")}
          >
            {pending === "cancel" ? <Spinner /> : null}
            {t("common.cancel")}
          </Button>
          {onSwitchAccount ? (
            <p className="flex flex-wrap items-center justify-center gap-x-1 text-label text-muted-foreground">
              {t("auth.desktop.notYouQuestion")}
              {/* Button primitive for the 44px coarse-pointer floor, drawn as the
                  credential screens' inline link. Signing out takes a moment
                  before the page moves on: it says so, like its neighbours. */}
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-1 text-label text-brand"
                aria-disabled={busy || undefined}
                aria-busy={switching || undefined}
                onClick={() => void switchAccount()}
              >
                {switching ? <Spinner /> : null}
                {switching ? t("auth.desktop.signingOut") : t("auth.desktop.useAnother")}
              </Button>
            </p>
          ) : null}
        </div>
      </div>
    </AuthShell>
  );
}

// The approved callback is the attempt's redirect_uri (allowlisted by the
// server at Start) plus ?code=&state=, so only its scheme, host and path count.
export function isDesktopCallbackUrl(value: string, redirectUri: string | undefined): boolean {
  if (!redirectUri) return false;
  try {
    const url = new URL(value);
    const redirect = new URL(redirectUri);
    return url.protocol === redirect.protocol && url.hostname === redirect.hostname && url.pathname === redirect.pathname;
  } catch {
    return false;
  }
}
