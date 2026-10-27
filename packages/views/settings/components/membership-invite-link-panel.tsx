"use client";

import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MembershipInviteLink } from "@uniwork/core/api/endpoints/membership-invite-links";
import { paths } from "@uniwork/core/paths";
import { runtimeConfig } from "@uniwork/core/runtime-config";
import {
  useCreateOrgInviteLink,
  useCreateWorkspaceInviteLink,
  useOrgInviteLinks,
  useRegenerateOrgInviteLink,
  useRegenerateWorkspaceInviteLink,
  useRevokeOrgInviteLink,
  useRevokeWorkspaceInviteLink,
  useWorkspaceInviteLinks,
} from "@uniwork/core/workspaces/membership-invite-hooks";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import { InviteWorkspacePicker } from "./invite-workspace-picker";
import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsSection,
} from "./settings-layout";

function membershipInviteUrl(linkId: string, secret: string): string {
  return `${runtimeConfig().appUrl}${paths.membershipInvite(linkId)}#secret=${secret}`;
}

function activeLink(links: MembershipInviteLink[] | undefined): MembershipInviteLink | null {
  return links?.find((l) => l.status === "active" && l.secret) ?? null;
}

function ExpirySelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number;
  onChange: (days: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const items = [1, 7, 14, 30].map((days) => ({
    value: String(days),
    label: t("inviteLink.expiryDays", { count: days }),
  }));
  return (
    <Select
      id={id}
      value={String(value)}
      disabled={disabled}
      aria-label={t("inviteLink.expiry")}
      items={items}
      onValueChange={(v) => onChange(Number(v))}
    />
  );
}

function LinkActions({
  link,
  pending,
  onCopy,
  onRevoke,
  onRegenerate,
}: {
  link: MembershipInviteLink;
  pending: boolean;
  onCopy: () => void;
  onRevoke: () => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SettingsBadge>{t(`inviteLink.status.${link.status}`)}</SettingsBadge>
        <span className="text-caption text-muted-foreground break-all">
          {membershipInviteUrl(link.id, link.secret)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !link.secret}
          onClick={() => {
            onCopy();
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? t("inviteLink.copied") : t("inviteLink.copy")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onRegenerate}>
          <RefreshCw className="size-4" aria-hidden />
          {t("inviteLink.regenerate")}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onRevoke}>
          {t("inviteLink.revoke")}
        </Button>
      </div>
    </div>
  );
}

/** Invite-by-link panel for Settings → Members (one workspace). */
export function WorkspaceInviteLinkPanel({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const { data: links } = useWorkspaceInviteLinks(workspaceId);
  const create = useCreateWorkspaceInviteLink(workspaceId);
  const revoke = useRevokeWorkspaceInviteLink(workspaceId);
  const regenerate = useRegenerateWorkspaceInviteLink(workspaceId);
  const [days, setDays] = useState(7);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const active = activeLink(links);
  const pending = create.isPending || revoke.isPending || regenerate.isPending;

  const copy = async (link: MembershipInviteLink) => {
    try {
      await navigator.clipboard.writeText(membershipInviteUrl(link.id, link.secret));
      toast.success(t("inviteLink.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <SettingsSection title={t("inviteLink.workspaceTitle")} description={t("inviteLink.workspaceDescription")}>
      <SettingsCard>
        <SettingsCardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <ExpirySelect id="ws-invite-expiry" value={days} onChange={setDays} disabled={pending} />
            </div>
            {!active ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => {
                  create.mutate(
                    { expires_in_days: days },
                    {
                      onSuccess: (link) => {
                        if (link?.secret) void copy(link);
                        else toast.success(t("inviteLink.created"));
                      },
                      onError: (err) => toastApiError(err, t("common.error")),
                    },
                  );
                }}
              >
                <Link2 className="size-4" aria-hidden />
                {t("inviteLink.create")}
              </Button>
            ) : null}
          </div>
          {active ? (
            <LinkActions
              link={active}
              pending={pending}
              onCopy={() => void copy(active)}
              onRevoke={() => setRevokeOpen(true)}
              onRegenerate={() => {
                regenerate.mutate(
                  { expires_in_days: days },
                  {
                    onSuccess: (link) => {
                      if (link?.secret) void copy(link);
                      toast.success(t("inviteLink.regenerated"));
                    },
                    onError: (err) => toastApiError(err, t("common.error")),
                  },
                );
              }}
            />
          ) : null}
        </SettingsCardBody>
      </SettingsCard>
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t("inviteLink.revokeTitle")}
        description={t("inviteLink.revokeBody")}
        confirmLabel={t("inviteLink.revoke")}
        pending={revoke.isPending}
        onConfirm={() => {
          if (!active) return;
          revoke.mutate(active.id, {
            onSuccess: () => {
              toast.success(t("inviteLink.revoked"));
              setRevokeOpen(false);
            },
            onError: (err) => toastApiError(err, t("common.error")),
          });
        }}
      />
    </SettingsSection>
  );
}

/** Invite-by-link panel for Organization Members (one or many workspaces). */
export function OrgInviteLinkPanel({ orgSlug, orgId }: { orgSlug: string; orgId: string }) {
  const { t } = useTranslation();
  const { data: links } = useOrgInviteLinks(orgSlug);
  const create = useCreateOrgInviteLink(orgSlug);
  const revoke = useRevokeOrgInviteLink(orgSlug);
  const regenerate = useRegenerateOrgInviteLink(orgSlug);
  const [days, setDays] = useState(7);
  const [workspaceIds, setWorkspaceIds] = useState<string[]>([]);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const active = activeLink(links);
  const pending = create.isPending || revoke.isPending || regenerate.isPending;
  const canCreate = workspaceIds.length > 0 && !pending;

  const copy = async (link: MembershipInviteLink) => {
    try {
      await navigator.clipboard.writeText(membershipInviteUrl(link.id, link.secret));
      toast.success(t("inviteLink.copied"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  return (
    <SettingsSection title={t("inviteLink.orgTitle")} description={t("inviteLink.orgDescription")}>
      <SettingsCard>
        <SettingsCardBody className="space-y-3">
          <InviteWorkspacePicker
            id="org-invite-link-workspaces"
            orgId={orgId}
            value={workspaceIds}
            onChange={setWorkspaceIds}
            disabled={pending || !!active}
            label={t("inviteLink.workspacesLabel")}
            hint={t("inviteLink.workspacesHint")}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <ExpirySelect id="org-invite-expiry" value={days} onChange={setDays} disabled={pending} />
            </div>
            {!active ? (
              <Button
                type="button"
                disabled={!canCreate}
                onClick={() => {
                  create.mutate(
                    { workspace_ids: workspaceIds, expires_in_days: days },
                    {
                      onSuccess: (link) => {
                        if (link?.secret) void copy(link);
                        else toast.success(t("inviteLink.created"));
                      },
                      onError: (err) => toastApiError(err, t("common.error")),
                    },
                  );
                }}
              >
                <Link2 className="size-4" aria-hidden />
                {t("inviteLink.create")}
              </Button>
            ) : null}
          </div>
          {active ? (
            <LinkActions
              link={active}
              pending={pending}
              onCopy={() => void copy(active)}
              onRevoke={() => setRevokeOpen(true)}
              onRegenerate={() => {
                regenerate.mutate(
                  { linkId: active.id, expires_in_days: days },
                  {
                    onSuccess: (link) => {
                      if (link?.secret) void copy(link);
                      toast.success(t("inviteLink.regenerated"));
                    },
                    onError: (err) => toastApiError(err, t("common.error")),
                  },
                );
              }}
            />
          ) : null}
        </SettingsCardBody>
      </SettingsCard>
      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title={t("inviteLink.revokeTitle")}
        description={t("inviteLink.revokeBody")}
        confirmLabel={t("inviteLink.revoke")}
        pending={revoke.isPending}
        onConfirm={() => {
          if (!active) return;
          revoke.mutate(active.id, {
            onSuccess: () => {
              toast.success(t("inviteLink.revoked"));
              setRevokeOpen(false);
            },
            onError: (err) => toastApiError(err, t("common.error")),
          });
        }}
      />
    </SettingsSection>
  );
}
