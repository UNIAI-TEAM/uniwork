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
import { InviteForm, type InviteRole } from "./invite-form";
import {
  SettingsBadge,
  SettingsCardBody,
  SettingsList,
  SettingsListItem,
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
  const { data, isLoading } = useOrgInvitations(orgSlug);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [revoking, setRevoking] = useState<OrgInvitation | null>(null);
  const pending = data?.invitations ?? [];
  const now = Date.now();

  const send = async (emails: string[], role: InviteRole) => {
    try {
      const result = await invite.mutateAsync({ emails, orgRole: role });
      setSkipped(result?.skipped ?? []);
      toast.success(t("org.invitations.sent", { count: result?.invitations.length ?? 0 }));
      return true;
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
        setRevoking(null);
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
        >
          {skipped.length > 0 ? (
            <SettingsCardBody className="text-caption text-muted-foreground">
              {t("workspace.inviteSkipped", { list: skipped.join(", ") })}
            </SettingsCardBody>
          ) : null}
        </InviteForm>
      </SettingsSection>

      {isLoading ? (
        <SettingsSkeletonRows rows={2} withAvatar />
      ) : pending.length > 0 ? (
        <SettingsSection title={t("org.invitations.pending_title")} description={t("org.invitations.pending_description")}>
          <SettingsList aria-label={t("org.invitations.pending_title")}>
            {pending.map((inv) => {
              const expiresAt = Date.parse(inv.expires_at);
              const expired = !Number.isNaN(expiresAt) && expiresAt < now;
              const sent = formatDay(inv.created_at, i18n.language);
              const expires = formatDay(inv.expires_at, i18n.language);
              const meta = [
                t(`people.role_${inv.org_role}`, { defaultValue: inv.org_role }),
                sent ? t("org.invitations.sent_on", { date: sent }) : "",
                expires && !expired ? t("org.invitations.expires_on", { date: expires }) : "",
                inv.invited_by_name ? t("org.invitations.invited_by", { name: inv.invited_by_name }) : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <SettingsListItem
                  key={inv.id}
                  leading={<IconTile icon={Mail} size="sm" shape="circle" />}
                  title={inv.email}
                  badge={expired ? <SettingsBadge tone="warning">{t("org.invitations.expired")}</SettingsBadge> : null}
                  meta={meta}
                  actions={
                    <Button type="button" variant="ghost" size="sm" onClick={() => setRevoking(inv)}>
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
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setRevoking(null);
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
