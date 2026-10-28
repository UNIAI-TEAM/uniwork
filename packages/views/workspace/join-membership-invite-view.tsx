"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, errorCode } from "@uniwork/core/api";
import { useSession } from "@uniwork/core/auth";
import type { MembershipInvitePreview } from "@uniwork/core/api/endpoints/membership-invite-links";
import type { StepUpProof } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { readSignInFailure } from "@uniwork/core/auth/sign-in-errors";
import { organizationSwitchConflicts } from "@uniwork/core/organizations/errors";
import { paths } from "@uniwork/core/paths";
import type { InvitationPreview, MembershipConflict, SwitchResolution, Workspace } from "@uniwork/core/types";
import {
  useJoinMembershipInviteLink,
  useMembershipInvitePreview,
} from "@uniwork/core/workspaces/membership-invite-hooks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { AuthShell } from "../auth/auth-shell";
import { toastApiError } from "../toast-api-error";
import { useNavigation } from "../navigation";
import { InviteErrorBody, inviteErrorReason } from "./accept-invite/invite-error";
import { JoinInvitationBody } from "./accept-invite/invitation-card";
import type { RetryReason } from "./accept-invite/invite-notices";
import {
  goneReason,
  InvitationGoneBody,
  InviteJoining,
  InvitePreviewSkeleton,
  type GoneReason,
} from "./accept-invite/invite-screens";
import { SwitchWizard } from "./accept-invite/switch-wizard";
import { readMembershipInviteSecret } from "./membership-invite-secret";

type Refusal =
  | { kind: "changed"; conflicts: MembershipConflict[] | null }
  | { kind: "gone"; reason: GoneReason }
  | { kind: "proof"; proofs: readonly StepUpProof[] }
  | { kind: "retry"; why: RetryReason; error: unknown }
  | { kind: "fatal"; error: unknown };

function classify(err: unknown): Refusal {
  const code = errorCode(err);
  if (code === "organization_switch_required") return { kind: "changed", conflicts: organizationSwitchConflicts(err) };
  if (code === "close_confirm_mismatch") return { kind: "changed", conflicts: null };
  if (code === "invite_link_expired") return { kind: "gone", reason: "expired" };
  if (code === "invite_link_revoked") return { kind: "gone", reason: "revoked" };
  const gone = goneReason(code);
  if (gone) return { kind: "gone", reason: gone };
  // The owner's proof no longer serves (ADR 0047 §5): the wizard asks again.
  const failure = readSignInFailure(err, "methods");
  if (failure.kind === "step_up") return { kind: "proof", proofs: failure.proofs ?? [] };
  if (code === "membership_busy") return { kind: "retry", why: "busy", error: err };
  return { kind: "fatal", error: err };
}

function transient(err: unknown): boolean {
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 429;
}

/** Shape SwitchWizard / JoinInvitationBody already expect from email invitations. */
function asInvitation(data: MembershipInvitePreview): InvitationPreview["invitation"] {
  const workspaces = data.workspaces.map((w) => ({ id: w.id, slug: w.slug, name: w.name }));
  return {
    id: data.link_id,
    status: data.status === "active" ? "pending" : data.status,
    expires_at: "",
    organization: {
      id: data.organization.id,
      slug: data.organization.slug,
      name: data.organization.name,
    },
    workspace: workspaces.length === 1 ? workspaces[0] : undefined,
    workspaces,
    org_role: "member",
  };
}

type Screen = { id: string; title?: string; description?: string; body: ReactNode; nameInTitle?: boolean };

/**
 * /join/{linkId}#secret=… — shareable membership invite link. Reuses the
 * email-invite switch wizard when ADR 0032 conflicts stand in the way.
 */
export function JoinMembershipInviteView({ linkId }: { linkId: string }) {
  const { t } = useTranslation();
  const { status } = useSession();
  const navigation = useNavigation();
  // Read on first paint so the login `next` keeps #secret=… (hash is lost on
  // some OAuth returns; sessionStorage is the backup — see membership-invite-secret).
  const [secret, setSecret] = useState(() => readMembershipInviteSecret(linkId));
  const [joined, setJoined] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fresh, setFresh] = useState<MembershipConflict[] | null>(null);
  const [round, setRound] = useState(0);
  const [startAt, setStartAt] = useState(1);

  useEffect(() => {
    setSecret(readMembershipInviteSecret(linkId));
  }, [linkId]);

  const nextPath = useMemo(
    () => paths.membershipInvite(linkId) + (secret ? `#secret=${secret}` : ""),
    [linkId, secret],
  );

  useEffect(() => {
    if (status === "anon") {
      navigation.replace(`${paths.login()}?next=${encodeURIComponent(nextPath)}`);
    }
  }, [status, navigation, nextPath]);

  const enabled = status === "authed" && !!secret && !!linkId && !joined;
  const preview = useMembershipInvitePreview(linkId, secret, enabled);
  const join = useJoinMembershipInviteLink();

  // Where the email invitation lands too (apps/web/app/invite/[token]): the
  // workspace's tasks, so both ways in arrive on the same screen.
  const land = (workspace: Workspace | null, orgSlug?: string) => {
    if (workspace?.organization_slug && workspace.slug) {
      navigation.replace(paths.workspace(workspace.organization_slug, workspace.slug).tasks());
      return;
    }
    if (orgSlug) {
      navigation.replace(paths.workspaces());
      return;
    }
    navigation.replace(paths.workspaces());
  };

  useEffect(() => {
    if (!preview.data?.already_member || joined) return;
    const first = preview.data.workspaces.find((w) => w.joined) ?? preview.data.workspaces[0];
    if (!first?.slug || !preview.data.organization.slug) return;
    setJoined(true);
    navigation.replace(paths.workspace(preview.data.organization.slug, first.slug).tasks());
  }, [preview.data, navigation, joined]);

  const submit = (resolve?: SwitchResolution[], onProofRequired?: (proofs: readonly StepUpProof[]) => void) => {
    setRefusal(null);
    join.mutate(
      { linkId, secret, resolve },
      {
        onSuccess: (result) => {
          setJoined(true);
          land(result.workspace, result.organization?.slug);
        },
        onError: (err) => {
          const next = classify(err);
          if (next.kind === "proof") {
            onProofRequired?.(next.proofs);
            return;
          }
          if (next.kind === "changed") {
            setFresh(next.conflicts);
            if (!next.conflicts) void preview.refetch();
            setStartAt(resolve?.length ? 2 : 1);
            setRound((r) => r + 1);
            return;
          }
          if (next.kind === "fatal" && resolve?.length && transient(err)) {
            setRefusal({ kind: "retry", why: "failed", error: err });
            return;
          }
          if (next.kind === "fatal" && !resolve?.length) {
            toastApiError(err, t("common.error"));
          }
          setRefusal(next);
        },
      },
    );
  };

  const data = preview.data;
  const loading = (): Screen =>
    round === 0
      ? { id: "loading", body: <InvitePreviewSkeleton /> }
      : {
          id: "loading",
          title: t("inviteLink.joinTitle"),
          description: t("invitations.loading_description"),
          body: <InvitePreviewSkeleton />,
        };

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
            void preview.refetch();
          }}
        />
      ),
    };
  };

  const gone = (reason: GoneReason): Screen => ({
    id: `gone-${reason}`,
    title: t("inviteLink.invalid"),
    description: t(`invitations.gone.${reason}`, { defaultValue: t("inviteLink.invalid") }),
    body: <InvitationGoneBody reason={reason} />,
  });

  const pick = (): Screen | null => {
    if (status !== "authed") return status === "anon" ? null : loading();
    if (!secret) {
      return {
        id: "no-secret",
        title: t("inviteLink.joinTitle"),
        description: t("inviteLink.invalid"),
        body: (
          <Button type="button" variant="outline" onClick={() => navigation.push(paths.workspaces())}>
            {t("workspace.acceptInviteError.goToWorkspaces")}
          </Button>
        ),
      };
    }
    if (refusal?.kind === "fatal") return failed(refusal.error);
    if (refusal?.kind === "gone") return gone(refusal.reason);
    if (preview.error) return failed(preview.error, preview.isFetching);
    if (joined) {
      return {
        id: "joining",
        title: t("workspace.acceptInviteJoining.title"),
        description: t("workspace.acceptInviteJoining.body"),
        body: <InviteJoining />,
      };
    }
    if (preview.isPending || (preview.isFetching && round > 0 && !fresh)) return loading();
    if (!data) return failed(null);

    if (data.status === "expired") return gone("expired");
    if (data.status === "revoked") return gone("revoked");
    if (!data.needs_join && !data.already_member) {
      return {
        id: "invalid",
        title: t("inviteLink.joinTitle"),
        description: t("inviteLink.invalid"),
        body: (
          <Button type="button" variant="outline" onClick={() => navigation.push(paths.workspaces())}>
            {t("workspace.acceptInviteError.goToWorkspaces")}
          </Button>
        ),
      };
    }

    const invitation = asInvitation(data);
    const name = invitation.organization.name;
    const conflicts = fresh ?? data.conflicts;
    const retry = refusal?.kind === "retry" ? refusal.why : null;
    const changed = round > 0;

    if (conflicts.length === 0) {
      const title = data.workspaces.length > 1 ? t("inviteLink.joinOrgTitle") : t("inviteLink.joinTitle");
      return {
        id: "join",
        title: t("invitations.preview.title", { name }),
        nameInTitle: true,
        description: title,
        body: (
          <div className="space-y-4">
            <ul className="space-y-2" aria-label={title}>
              {data.workspaces.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <span className="text-body">{w.name}</span>
                  <span className="text-caption text-muted-foreground">
                    {w.joined ? t("inviteLink.joined") : t("inviteLink.notJoined")}
                  </span>
                </li>
              ))}
            </ul>
            <JoinInvitationBody
              invitation={invitation}
              label={title}
              notice={changed}
              pending={join.isPending}
              retry={retry}
              onJoin={() => submit()}
            />
          </div>
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
          pending={join.isPending}
          retry={retry}
          onSubmit={submit}
        />
      ),
    };
  };

  const screen = pick();
  if (!screen) return null;
  return (
    <AuthShell title={screen.title} description={screen.description} nameInTitle={screen.nameInTitle}>
      <div key={screen.id} className="motion-safe:animate-onboarding-enter">
        {screen.body}
      </div>
    </AuthShell>
  );
}
