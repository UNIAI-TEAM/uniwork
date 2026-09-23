"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useInviteToOrganization,
  useOrgInvitations,
  useRevokeOrgInvitation,
} from "@uniwork/core/organizations";
import type { OrgInvitation } from "@uniwork/core/types/people";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { toastApiError } from "../../toast-api-error";
import { InviteForm, type InviteRole, type InviteSendResult } from "./invite-form";
import {
  SettingsBadge,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
  SettingsSkeletonRows,
} from "./settings-layout";

function formatDay(iso: string, locale: string): string {
  const time = Date.parse(iso);
  if (!iso || Number.isNaN(time)) return "";
  return new Date(time).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Inviting people into the organization and the invitations still waiting
 * for an answer. Only mounted for someone who may manage members, so the
 * list query never fires for a plain member.
 */
export function OrgInvitationsSection({ orgSlug }: { orgSlug: string }) {
  const { t, i18n } = useTranslation();
  const invite = useInviteToOrganization(orgSlug);
  const revoke = useRevokeOrgInvitation(orgSlug);
  const { data, isLoading, isError, refetch } = useOrgInvitations(orgSlug);
  // The target outlives the dialog's open state, so the title keeps the
  // address while the dialog animates out.
  const [revoking, setRevoking] = useState<OrgInvitation | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const pending = data?.invitations ?? [];
  const now = Date.now();

  const send = async (emails: string[], role: InviteRole): Promise<InviteSendResult> => {
    try {
      const result = await invite.mutateAsync({ emails, orgRole: role });
      const count = result?.invitations.length ?? 0;
      // Every address skipped is not a success: no green toast for "sent 0".
      if (count === 0) toast.warning(t("org.invitations.none_sent"));
      else toast.success(t("org.invitations.sent", { count }));
      return { skipped: result?.skipped ?? [] };
    } catch (err) {
      toastApiError(err, t("common.error"));
      return false;
    }
  };

  const confirmRevoke = () => {
    if (!revoking || revoke.isPending) return;
    revoke.mutate(revoking.id, {
      onSuccess: () => {
        toast.success(t("org.invitations.revoked"));
        setRevokeOpen(false);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <>
      <SettingsSection title={t("org.invitations.title")} description={t("org.invitations.description")}>
        <InviteForm
          id="org-invite"
          submitLabel={t("org.invitations.send")}
          roleLabel={t("org.invitations.role")}
          pending={invite.isPending}
          onSend={send}
        />
      </SettingsSection>

      {isLoading ? (
        <SettingsSkeletonRows rows={2} withAvatar />
      ) : isError ? (
        <SettingsSection title={t("org.invitations.pending_title")}>
          <SettingsList aria-label={t("org.invitations.pending_title")}>
            <li>
              <SettingsLoadError onRetry={() => void refetch()}>{t("org.invitations.load_error")}</SettingsLoadError>
            </li>
          </SettingsList>
        </SettingsSection>
      ) : pending.length > 0 ? (
        <SettingsSection title={t("org.invitations.pending_title")} description={t("org.invitations.pending_description")}>
          <SettingsList aria-label={t("org.invitations.pending_title")}>
            {pending.map((inv) => {
              const expiresAt = Date.parse(inv.expires_at);
              const expired = !Number.isNaN(expiresAt) && expiresAt < now;
              const sent = formatDay(inv.created_at, i18n.language);
              const expires = formatDay(inv.expires_at, i18n.language);
              const parts = [
                t(`people.role_${inv.org_role}`, { defaultValue: inv.org_role }),
                sent ? t("org.invitations.sent_on", { date: sent }) : "",
                expires && !expired ? t("org.invitations.expires_on", { date: expires }) : "",
                inv.invited_by_name ? t("org.invitations.invited_by", { name: inv.invited_by_name }) : "",
              ].filter(Boolean);
              // Each fact keeps its words together and the line wraps between
              // them, so a phone shows two lines instead of an ellipsis.
              const meta = (
                <span className="flex flex-wrap gap-x-1 whitespace-normal">
                  {parts.map((part, i) => (
                    <span key={part} className="[overflow-wrap:anywhere]">
                      {i > 0 ? `· ${part}` : part}
                    </span>
                  ))}
                </span>
              );
              return (
                <SettingsListItem
                  key={inv.id}
                  leading={<IconTile icon={Mail} size="sm" shape="circle" />}
                  title={inv.email}
                  badge={expired ? <SettingsBadge tone="warning">{t("org.invitations.expired")}</SettingsBadge> : null}
                  meta={meta}
                  actions={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRevoking(inv);
                        setRevokeOpen(true);
                      }}
                    >
                      {t("org.invitations.revoke")}
                    </Button>
                  }
                />
              );
            })}
          </SettingsList>
        </SettingsSection>
      ) : null}

      <ConfirmDialog
        open={revokeOpen}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevokeOpen(false);
        }}
        title={t("org.invitations.revoke_title", { email: revoking?.email })}
        description={t("org.invitations.revoke_body")}
        confirmLabel={t("org.invitations.revoke")}
        onConfirm={confirmRevoke}
        pending={revoke.isPending}
      />
    </>
  );
}
