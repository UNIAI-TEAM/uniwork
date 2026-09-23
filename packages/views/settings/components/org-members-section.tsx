"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "@uniwork/core/auth";
import {
  useDeactivateOrgMember,
  useOrgMembers,
  useReactivateOrgMember,
  useUpdateOrgMemberRole,
} from "@uniwork/core/organizations";
import { usePeoplePermissions } from "@uniwork/core/permissions";
import type { OrgMember } from "@uniwork/core/types/people";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Button } from "@uniwork/ui/components/ui/button";
import { Select } from "@uniwork/ui/components/ui/select";
import { toast } from "sonner";
import { ConfirmDialog } from "../../common/form-dialog";
import { initials } from "../../people/actor-chip";
import { toastApiError } from "../../toast-api-error";
import { MemberSearch, matchesMember } from "./member-search";
import {
  SettingsBadge,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsSection,
  SettingsSkeletonRows,
} from "./settings-layout";

/**
 * Everyone in the organization, active or not. Deactivating locks a person
 * out of every workspace, so it goes through a confirmation; reactivating
 * only gives access back and is direct.
 */
export function OrgMembersSection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrgMembers(orgSlug, "all");
  const { decideChangeRole, decideDeactivate } = usePeoplePermissions(orgSlug);
  const updateRole = useUpdateOrgMemberRole(orgSlug);
  const deactivate = useDeactivateOrgMember(orgSlug);
  const reactivate = useReactivateOrgMember(orgSlug);
  const [query, setQuery] = useState("");
  const [deactivating, setDeactivating] = useState<OrgMember | null>(null);
  const members = (data?.pages ?? []).flatMap((p) => p.members);
  const shown = members.filter((m) => matchesMember(query, m));
  const count = members.length;

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

  const onReactivate = (member: OrgMember) => {
    if (reactivate.isPending) return;
    reactivate.mutate(member.user_id, {
      onSuccess: () => toast.success(t("org.members.reactivated")),
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  const confirmDeactivate = () => {
    if (!deactivating || deactivate.isPending) return;
    deactivate.mutate(deactivating.user_id, {
      onSuccess: () => {
        toast.success(t("org.members.deactivated"));
        setDeactivating(null);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  return (
    <SettingsSection
      title={
        isLoading
          ? null
          : hasNextPage
            ? t("settings.members.count_more", { count })
            : t("settings.members.count", { count })
      }
      action={isLoading ? null : <MemberSearch value={query} onChange={setQuery} />}
    >
      {isLoading ? (
        <SettingsSkeletonRows rows={4} withAvatar />
      ) : (
        <SettingsList aria-label={t("org.members.title")}>
          {shown.length === 0 ? (
            <li>
              <SettingsEmpty>
                {hasNextPage
                  ? t("settings.members.no_match_more", { query: query.trim() })
                  : t("settings.members.no_match", { query: query.trim() })}
              </SettingsEmpty>
            </li>
          ) : null}
          {shown.map((member) => {
            const target = { user_id: member.user_id, role: member.role };
            const changeRole = decideChangeRole(target);
            const toggle = decideDeactivate(target);
            const name = member.display_name || member.email;
            const isDeactivated = Boolean(member.deactivated_at);
            const reactivating = reactivate.isPending && reactivate.variables === member.user_id;
            return (
              <SettingsListItem
                key={member.user_id}
                muted={isDeactivated}
                leading={
                  <ActorAvatar name={name} initials={initials(name)} avatarUrl={member.avatar_url} size="lg" />
                }
                title={name}
                badge={
                  isDeactivated ? (
                    <SettingsBadge tone="warning">{t("org.members.status_deactivated")}</SettingsBadge>
                  ) : member.user_id === user?.id ? (
                    <SettingsBadge tone="brand">{t("settings.members.you")}</SettingsBadge>
                  ) : null
                }
                meta={member.email}
                actions={
                  <>
                    {changeRole.allowed ? (
                      <div className="w-36">
                        <Select
                          aria-label={t("org.members.change_role")}
                          value={member.role === "admin" ? "admin" : "member"}
                          disabled={updateRole.isPending}
                          onValueChange={(v) => onChangeRole(member, (v as string) ?? "member")}
                          items={[
                            { value: "member", label: t("people.role_member") },
                            { value: "admin", label: t("people.role_admin") },
                          ]}
                        />
                      </div>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {t(`people.role_${member.role}`, { defaultValue: member.role })}
                      </span>
                    )}
                    {toggle.allowed && isDeactivated ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-disabled={reactivate.isPending || undefined}
                        aria-busy={reactivating || undefined}
                        onClick={() => onReactivate(member)}
                      >
                        {t("org.members.reactivate")}
                      </Button>
                    ) : null}
                    {toggle.allowed && !isDeactivated ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setDeactivating(member)}>
                        {t("org.members.deactivate")}
                      </Button>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </SettingsList>
      )}
      {hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={isFetchingNextPage || undefined}
          aria-busy={isFetchingNextPage || undefined}
          onClick={() => {
            if (!isFetchingNextPage) void fetchNextPage();
          }}
        >
          {t("people.load_more")}
        </Button>
      ) : null}
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open && !deactivate.isPending) setDeactivating(null);
        }}
        title={t("org.members.deactivate_title", { name: deactivating?.display_name || deactivating?.email })}
        description={t("org.members.deactivate_body", { name: deactivating?.display_name || deactivating?.email })}
        confirmLabel={t("org.members.deactivate")}
        onConfirm={confirmDeactivate}
        pending={deactivate.isPending}
      />
    </SettingsSection>
  );
}
