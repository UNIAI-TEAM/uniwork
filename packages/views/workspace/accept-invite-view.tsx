"use client";
import { useEffect, useRef, useState } from "react";
import { errorCode } from "@uniwork/core/api";
import { useSession } from "@uniwork/core/auth";
import { organizationSwitchConflicts } from "@uniwork/core/organizations/errors";
import type { MembershipConflict, SwitchResolution, Workspace } from "@uniwork/core/types";
import { useAcceptInvite, useInvitationPreview } from "@uniwork/core/workspaces";
import { InviteErrorScreen } from "./accept-invite/invite-error";
import { goneReason, InvitationGoneScreen, InviteLoadingScreen, type GoneReason } from "./accept-invite/invite-screens";
import { JoinInvitationScreen } from "./accept-invite/invitation-card";
import { SwitchWizard, type PasswordRefusal } from "./accept-invite/switch-wizard";

/** What the page does after a refused accept, beyond showing it. */
type Refusal =
  | { kind: "changed"; conflicts: MembershipConflict[] | null }
  | { kind: "gone"; reason: GoneReason }
  | { kind: "password"; why: PasswordRefusal }
  | { kind: "busy" }
  | { kind: "fatal"; error: unknown };

function classify(err: unknown): Refusal {
  const code = errorCode(err);
  if (code === "organization_switch_required") return { kind: "changed", conflicts: organizationSwitchConflicts(err) };
  // The slug typed back was right when the page read it: it changed since.
  if (code === "close_confirm_mismatch") return { kind: "changed", conflicts: null };
  const gone = goneReason(code);
  if (gone) return { kind: "gone", reason: gone };
  if (code === "invalid_credentials" || code === "password_required") return { kind: "password", why: code };
  if (code === "membership_busy") return { kind: "busy" };
  return { kind: "fatal", error: err };
}

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
  const { status } = useSession();
  const accept = useAcceptInvite();
  // Once joined the page only waits for the host to navigate; the preview
  // must not refetch into "accepted" and accept a second time.
  const [joined, setJoined] = useState(false);
  const preview = useInvitationPreview(token, status === "authed" && !joined);
  // The last refusal still on screen (busy, gone, fatal); cleared on the next try.
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

  if (status !== "authed") return status === "anon" ? null : <InviteLoadingScreen />;
  if (refusal?.kind === "fatal") return <InviteErrorScreen error={refusal.error} />;
  if (refusal?.kind === "gone") return <InvitationGoneScreen reason={refusal.reason} />;
  if (preview.error) return <InviteErrorScreen error={preview.error} />;
  if (joined || invitationStatus === "accepted") return <InviteLoadingScreen joining />;
  if (preview.isPending || (preview.isFetching && round > 0 && !fresh)) return <InviteLoadingScreen />;
  if (!data) return <InviteErrorScreen error={null} />;
  const gone = goneReason(invitationStatus);
  if (gone) return <InvitationGoneScreen reason={gone} />;
  if (invitationStatus !== "pending") return <InviteErrorScreen error={null} />;

  const changed = round > 0;
  const conflicts = fresh ?? data.conflicts;
  const busy = refusal?.kind === "busy";
  if (conflicts.length === 0) {
    return (
      <JoinInvitationScreen
        invitation={data.invitation}
        notice={changed}
        pending={accept.isPending}
        busy={busy}
        onJoin={() => submit()}
      />
    );
  }
  return (
    <SwitchWizard
      key={round}
      invitation={data.invitation}
      conflicts={conflicts}
      startAt={startAt}
      notice={changed}
      pending={accept.isPending}
      busy={busy}
      onSubmit={submit}
    />
  );
}
