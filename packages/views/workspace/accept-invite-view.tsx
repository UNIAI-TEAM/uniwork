"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorCode } from "@uniwork/core/api";
import { useSession } from "@uniwork/core/auth";
import { organizationSwitchConflicts, passwordRefusal, type PasswordRefusal } from "@uniwork/core/organizations/errors";
import type { MembershipConflict, SwitchResolution, Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useInvitationPreview } from "@uniwork/core/workspaces";
import { AuthShell } from "../auth/auth-shell";
import { InviteErrorBody, inviteErrorReason } from "./accept-invite/invite-error";
import {
  goneReason,
  InvitationGoneBody,
  InviteJoining,
  InvitePreviewSkeleton,
  type GoneReason,
} from "./accept-invite/invite-screens";
import { JoinInvitationBody } from "./accept-invite/invitation-card";
import type { RetryReason } from "./accept-invite/invite-notices";
import { SwitchWizard } from "./accept-invite/switch-wizard";

/** What the page does after a refused accept, beyond showing it. */
type Refusal =
  | { kind: "changed"; conflicts: MembershipConflict[] | null }
  | { kind: "gone"; reason: GoneReason }
  | { kind: "password"; why: PasswordRefusal }
  | { kind: "retry"; why: RetryReason; error: unknown }
  | { kind: "fatal"; error: unknown };

function classify(err: unknown): Refusal {
  const code = errorCode(err);
  if (code === "organization_switch_required") return { kind: "changed", conflicts: organizationSwitchConflicts(err) };
  // The slug typed back was right when the page read it: it changed since.
  if (code === "close_confirm_mismatch") return { kind: "changed", conflicts: null };
  const gone = goneReason(code);
  if (gone) return { kind: "gone", reason: gone };
  const password = passwordRefusal(err);
  if (password) return { kind: "password", why: password };
  if (code === "membership_busy") return { kind: "retry", why: "busy", error: err };
  return { kind: "fatal", error: err };
}

/** A failure that says nothing about the switch itself: no answer, a server error, a rate limit. */
function transient(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
}

/**
 * One state of the page: what its shell says, and what it shows under that.
 * No title (and no description) is the shell's loading frame: the page does
 * not yet know which screen it is.
 */
type Screen = { id: string; title?: string; description?: string; body: ReactNode; nameInTitle?: boolean };

/**
 * /invite/{token} (spec 2026-10-13 §6.1). Opening the link reads the
 * invitation and joins nothing: the person sees what they are invited to and,
 * if they already belong to another organization, walks through the switch.
 * The accept is one request whatever it involves, and any refusal leaves
 * them where they were (ADR 0032, AC-10).
 */
export function AcceptInviteView({
  token,
  onAccepted,
  onAnon,
}: {
  token: string;
  /**
   * `workspace` is null for an invitation to the organization itself: the
   * person is in the company but in no team yet, so the host sends them to the
   * workspace picker instead of into a workspace (F-03).
   */
  onAccepted: (workspace: Workspace | null) => void;
  onAnon: () => void;
}) {
  const { t } = useTranslation();
  const { status } = useSession();
  const accept = useAcceptInvite();
  // Once joined the page only waits for the host to navigate; the preview
  // must not refetch into "accepted" and accept a second time.
  const [joined, setJoined] = useState(false);
  const preview = useInvitationPreview(token, status === "authed" && !joined);
  // The last refusal still on screen (retry, gone, fatal); cleared on the next try.
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // Conflicts a 409 carried, newer than the preview's; null to use the preview.
  const [fresh, setFresh] = useState<MembershipConflict[] | null>(null);
  // Bumped on every "the situation changed": the wizard remounts with fresh
  // conflicts and nothing typed against the old ones, and says why.
  const [round, setRound] = useState(0);
  const [startAt, setStartAt] = useState(1);
  const autoAccepted = useRef(false);

  useEffect(() => {
    if (status === "anon") onAnon();
  }, [status, onAnon]);

  const submit = (resolve?: SwitchResolution[], onPasswordRefused?: (why: PasswordRefusal) => void) => {
    setRefusal(null);
    accept.mutate(
      { token, resolve },
      {
        onSuccess: (result) => {
          setJoined(true);
          onAccepted(result.workspace);
        },
        onError: (err) => {
          const next = classify(err);
          if (next.kind === "password") {
            onPasswordRefused?.(next.why);
            return;
          }
          if (next.kind === "changed") {
            setFresh(next.conflicts);
            // Without readable conflicts in the refusal, read the invitation again.
            if (!next.conflicts) void preview.refetch();
            // A refusal mid-switch goes back to the organizations; one that
            // turns a plain join into a switch starts at the beginning.
            setStartAt(resolve?.length ? 2 : 1);
            setRound((r) => r + 1);
            return;
          }
          // A switch that failed in passing keeps the wizard and what was
          // chosen in it: the same button sends it again.
          if (next.kind === "fatal" && resolve?.length && transient(err)) {
            setRefusal({ kind: "retry", why: "failed", error: err });
            return;
          }
          setRefusal(next);
        },
      },
    );
  };

  const data = preview.data;
  const invitationStatus = data?.invitation.status;

  // An accepted invitation answers 200 again to the member it admitted, and
  // 410 invitation_accepted to anybody else: asking joins nobody new. Not
  // while an accept of this page's is under way or has succeeded: its success
  // drops the cache and reads /me before `joined` is set, and the preview read
  // again in that window already says "accepted".
  useEffect(() => {
    if (invitationStatus === "accepted" && !joined && !accept.isPending && !accept.isSuccess && !autoAccepted.current) {
      autoAccepted.current = true;
      submit();
    }
  });

  // The first read gives the shell no title: AuthShell holds the heading's
  // place, and the real title arrives without taking focus. A read again
  // after the situation changed keeps a title, so the screen that follows it
  // is heard as the change it is.
  const loading = (): Screen =>
    round === 0
      ? { id: "loading", body: <InvitePreviewSkeleton /> }
      : {
          id: "loading",
          title: t("invitations.title"),
          description: t("invitations.loading_description"),
          body: <InvitePreviewSkeleton />,
        };
  // `retrying`: the invitation is being read again after a failed read. With
  // nothing cached that read shows the skeleton; with a stale preview cached
  // the error stays on screen, so its Retry button carries the wait.
  const failed = (error: unknown, retrying = false): Screen => {
    const reason = inviteErrorReason(error);
    return {
      id: `error-${reason}`,
      title: t("workspace.acceptInviteError.title"),
      description: t(`workspace.acceptInviteError.${reason}`),
      body: (
        <InviteErrorBody
          reason={reason}
          retrying={retrying}
          onRetry={() => {
            setRefusal(null);
            // An accepted invitation is asked again by the effect, not by a button.
            autoAccepted.current = false;
            void preview.refetch();
          }}
        />
      ),
    };
  };
  const gone = (reason: GoneReason): Screen => ({
    id: `gone-${reason}`,
    title: t("invitations.gone.title"),
    description: t(`invitations.gone.${reason}`),
    body: <InvitationGoneBody reason={reason} />,
  });

  const pick = (): Screen | null => {
    if (status !== "authed") return status === "anon" ? null : loading();
    if (refusal?.kind === "fatal") return failed(refusal.error);
    if (refusal?.kind === "gone") return gone(refusal.reason);
    if (preview.error) return failed(preview.error, preview.isFetching);
    // The repeat ask of an accepted invitation met another change: no button
    // to press again on the "joining" screen, so offer the retry here.
    if (!joined && invitationStatus === "accepted" && refusal?.kind === "retry") return failed(refusal.error);
    if (joined || invitationStatus === "accepted") {
      return {
        id: "joining",
        title: t("workspace.acceptInviteJoining.title"),
        description: t("workspace.acceptInviteJoining.body"),
        body: <InviteJoining />,
      };
    }
    if (preview.isPending || (preview.isFetching && round > 0 && !fresh)) return loading();
    if (!data) return failed(null);
    const spent = goneReason(invitationStatus);
    if (spent) return gone(spent);
    if (invitationStatus !== "pending") return failed(null);

    const invitation = data.invitation;
    const name = invitation.organization.name;
    const changed = round > 0;
    const conflicts = fresh ?? data.conflicts;
    const retry = refusal?.kind === "retry" ? refusal.why : null;
    if (conflicts.length === 0) {
      const title = t("invitations.preview.title", { name });
      return {
        id: "join",
        title,
        nameInTitle: true,
        description: invitation.inviter_name
          ? t("invitations.preview.description_inviter", { inviter: invitation.inviter_name })
          : t("invitations.preview.description"),
        body: (
          <JoinInvitationBody
            invitation={invitation}
            label={title}
            notice={changed}
            pending={accept.isPending}
            retry={retry}
            onJoin={() => submit()}
          />
        ),
      };
    }
    return {
      id: "switch",
      title: t("invitations.switch.title", { name }),
      nameInTitle: true,
      description: t("invitations.switch.description", { name }),
      body: (
        <SwitchWizard
          key={round}
          invitation={invitation}
          conflicts={conflicts}
          startAt={startAt}
          notice={changed}
          pending={accept.isPending}
          retry={retry}
          onSubmit={submit}
        />
      ),
    };
  };

  const screen = pick();
  if (!screen) return null;
  // One shell for every state: its entrance plays once, and a new title (the
  // preview arriving, a refusal, the join under way) moves focus to its
  // heading, which is how the change is announced. Inside, each state fades
  // in by opacity alone.
  return (
    <AuthShell title={screen.title} description={screen.description} nameInTitle={screen.nameInTitle}>
      <div key={screen.id} className="motion-safe:animate-onboarding-enter">
        {screen.body}
      </div>
    </AuthShell>
  );
}
