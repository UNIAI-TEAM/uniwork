"use client";
import {
  CalendarClock,
  CircleAlert,
  CirclePause,
  Hourglass,
  Link2Off,
  MailCheck,
  RefreshCw,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@uniwork/core/api";
import { useLogout } from "@uniwork/core/auth";
import { paths } from "@uniwork/core/paths";
import type { IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { InviteNotice } from "./invite-notices";
import { SeeInvitationsLink } from "./invite-screens";

export type InviteErrorReason =
  | "gone"
  | "deactivated"
  | "wrongAccount"
  | "unverified"
  | "suspended"
  | "deletionScheduled"
  | "rateLimited"
  | "failed";

/**
 * A broken invitation is ordinary: the link was used, revoked, or mistyped.
 * Each code the server answers with maps to a sentence that says what
 * happened and what to do next; an unknown code (and a malformed response,
 * `null`) falls back to the generic sentence instead of leaking the server's
 * English message. The page's AuthShell shows the reason as its description.
 */
export function inviteErrorReason(error: unknown): InviteErrorReason {
  if (error instanceof ApiError) {
    if (error.code === "not_found" || error.status === 404) return "gone";
    if (error.code === "member_deactivated") return "deactivated";
    // The link was opened under an account other than the address it was
    // sent to; the server refuses it so a forwarded link cannot be redeemed
    // by whoever it reaches.
    if (error.code === "invitation_email_mismatch") return "wrongAccount";
    // Only an account that has proven the invited address may redeem it, so
    // the code sent at sign-up comes first.
    if (error.code === "email_unverified") return "unverified";
    if (error.code === "organization_suspended") return "suspended";
    // An organization waiting out its deletion takes nobody new: joining it
    // would leave the person in an organization every gate refuses them.
    if (error.code === "organization_deletion_scheduled") return "deletionScheduled";
    if (error.status === 429) return "rateLimited";
  }
  return "failed";
}

/**
 * Each reason's glyph, and the line under it that says what to do next. No
 * hint where the description already says it (wait, ask an admin) or where
 * the way forward is the retry button.
 */
const REASONS: Record<InviteErrorReason, { icon: LucideIcon; tone: IconTileTone; hintKey?: string }> = {
  gone: { icon: Link2Off, tone: "muted", hintKey: "workspace.acceptInviteError.hint" },
  wrongAccount: { icon: UserRoundX, tone: "warning", hintKey: "workspace.acceptInviteError.wrongAccountHint" },
  unverified: { icon: MailCheck, tone: "info", hintKey: "workspace.acceptInviteError.unverifiedHint" },
  suspended: { icon: CirclePause, tone: "warning", hintKey: "workspace.acceptInviteError.askInviterHint" },
  deletionScheduled: { icon: CalendarClock, tone: "warning", hintKey: "workspace.acceptInviteError.askInviterHint" },
  deactivated: { icon: UserRoundX, tone: "muted" },
  rateLimited: { icon: Hourglass, tone: "muted" },
  failed: { icon: CircleAlert, tone: "destructive" },
};

/** Reasons a second try can fix: a rate limit that runs out, a failure that may not repeat. */
const RETRYABLE: ReadonlySet<InviteErrorReason> = new Set(["rateLimited", "failed"]);

/**
 * The body of "Không dùng được lời mời này": why, and a way forward for
 * every reason. The shell's heading takes focus when this replaces the
 * loading or the preview, which is what announces it.
 */
export function InviteErrorBody({
  reason,
  onRetry,
  retrying = false,
}: {
  reason: InviteErrorReason;
  onRetry: () => void;
  /** The invitation is being read again after a retry: the button shows it working and asks only once. */
  retrying?: boolean;
}) {
  const { t } = useTranslation();
  const logout = useLogout();
  const { icon, tone, hintKey } = REASONS[reason];
  const retry = RETRYABLE.has(reason);
  // One filled action per screen: when a reason has its own, "my workspaces" steps down to outline.
  const ownAction = retry || reason === "wrongAccount" || reason === "unverified";
  return (
    <div className="flex flex-col gap-6">
      {hintKey ? (
        <InviteNotice icon={icon} tone={tone}>
          {t(hintKey)}
        </InviteNotice>
      ) : null}
      <div className="flex flex-col gap-3">
        {/* Signing out lands on login with this invite as `next` (onAnon),
            so the invitee comes straight back after switching account. */}
        {reason === "wrongAccount" ? (
          <Button
            type="button"
            size="lg"
            // While signing out the button reads as working, not as unavailable.
            className={cn("w-full", logout.isPending && "aria-disabled:cursor-progress aria-disabled:opacity-100")}
            aria-disabled={logout.isPending || undefined}
            aria-busy={logout.isPending || undefined}
            onClick={() => {
              if (!logout.isPending) logout.mutate();
            }}
          >
            {/* Decorative: the button's name stays "Dùng tài khoản khác". */}
            {logout.isPending ? <Spinner /> : null}
            {t("workspace.acceptInviteError.switchAccount")}
          </Button>
        ) : null}
        {reason === "unverified" ? (
          <AppLink href={paths.verify()} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
            {t("workspace.acceptInviteError.verifyEmail")}
          </AppLink>
        ) : null}
        {retry ? (
          <Button
            type="button"
            size="lg"
            className={cn("w-full", retrying && "aria-disabled:cursor-progress aria-disabled:opacity-100")}
            aria-disabled={retrying || undefined}
            aria-busy={retrying || undefined}
            onClick={() => {
              if (!retrying) onRetry();
            }}
          >
            {/* Decorative: aria-busy carries the state; the name stays "Thử lại". */}
            {retrying ? <Spinner /> : <RefreshCw aria-hidden />}
            {t("common.retry")}
          </Button>
        ) : null}
        {/* A link dressed as a button: it navigates, so it stays an <a> for
            screen readers rather than a Button with a borrowed role. */}
        <AppLink
          href={paths.workspaces()}
          className={cn(buttonVariants({ size: "lg", variant: ownAction ? "outline" : "default" }), "w-full")}
        >
          {t("workspace.acceptInviteError.goToWorkspaces")}
        </AppLink>
        <SeeInvitationsLink />
      </div>
    </div>
  );
}
