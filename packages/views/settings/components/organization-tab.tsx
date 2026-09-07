"use client";

import { useTranslation } from "react-i18next";
import {
  useDeactivateOrgMember,
  useLeaveOrganization,
  useOrgMembers,
  useReactivateOrgMember,
  useUpdateOrgMemberRole,
} from "@uniwork/core/organizations";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import type { OrgMember } from "@uniwork/core/types/people";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { toast } from "sonner";
import { useWorkspace } from "../../layout/workspace-context";
import { toastApiError } from "../../toast-api-error";
import { SettingsSection, SettingsTab } from "./settings-layout";

/**
 * Organization membership, as opposed to workspace membership: who belongs to
 * the company, in what role, and whether they may still enter it.
 */
export function OrganizationTab() {
  const { t } = useTranslation();
  const { workspace } = useWorkspace();
  const orgSlug = workspace.organization_slug;
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrgMembers(orgSlug, "all");
  const { decideChangeRole, decideDeactivate, canLeave } = usePeoplePermissions(orgSlug);
  const updateRole = useUpdateOrgMemberRole(orgSlug);
  const deactivate = useDeactivateOrgMember(orgSlug);
  const reactivate = useReactivateOrgMember(orgSlug);
  const leave = useLeaveOrganization(orgSlug);
  const members = (data?.pages ?? []).flatMap((p) => p.members);

  const onChangeRole = (member: OrgMember, role: string) => {
    if (member.role === role || updateRole.isPending) return;
    updateRole.mutate(
      { userId: member.user_id, role },
      {
        onSuccess: () => toast.success(t("org.members.role_updated")),
        onError: (err) => toastApiError(err, t("common.error")),
      },
    );
  };

  const onToggleActive = (member: OrgMember) => {
    const mutation = member.deactivated_at ? reactivate : deactivate;
    if (mutation.isPending) return;
    mutation.mutate(member.user_id, {
      onSuccess: () =>
        toast.success(
          member.deactivated_at ? t("org.members.reactivated") : t("org.members.deactivated"),
        ),
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsTab title={t("settings.page.tabs.organization")}>
      <SettingsSection
        title={t("org.members.title")}
        description={t("org.members.description")}
      >
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {members.map((member) => {
              const target = { user_id: member.user_id, role: member.role };
              const changeRole = decideChangeRole(target);
              const toggle = decideDeactivate(target);
              return (
                <li
                  key={member.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-body text-foreground">
                      {member.display_name}
                      {member.deactivated_at ? (
                        <span className="ml-2 text-caption text-muted-foreground">
                          {t("org.members.status_deactivated")}
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-caption text-muted-foreground">{member.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {changeRole.allowed ? (
                      <Select
                        aria-label={t("org.members.change_role")}
                        value={member.role === "admin" ? "admin" : "member"}
                        onValueChange={(v) => onChangeRole(member, (v as string) ?? "member")}
                        items={[
                          { value: "member", label: t("people.role_member") },
                          { value: "admin", label: t("people.role_admin") },
                        ]}
                      />
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {t(`people.role_${member.role}`, { defaultValue: member.role })}
                      </span>
                    )}
                    {toggle.allowed || member.deactivated_at ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={deactivate.isPending || reactivate.isPending || !toggle.allowed}
                        onClick={() => onToggleActive(member)}
                      >
                        {member.deactivated_at
                          ? t("org.members.reactivate")
                          : t("org.members.deactivate")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t("people.load_more")}
          </Button>
        ) : null}
      </SettingsSection>

      <SettingsSection title={t("org.leave.title")} description={t("org.leave.description")}>
        <Button
          type="button"
          variant="outline"
          disabled={!canLeave.allowed || leave.isPending}
          onClick={() =>
            leave.mutate(undefined, {
              onSuccess: () => toast.success(t("org.leave.done")),
              onError: (err) => toastApiError(err, t("common.error")),
            })
          }
        >
          {t("org.leave.action")}
        </Button>
        {!canLeave.allowed && canLeave.message ? (
          <p className="mt-2 text-caption text-muted-foreground">{canLeave.message}</p>
        ) : null}
      </SettingsSection>
    </SettingsTab>
  );
}
