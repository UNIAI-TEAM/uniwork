"use client";

import { useMemo, useState } from "react";
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
import { MemberSearch, fold, foldMember, matchesFolded } from "./member-search";
import { decisionReason } from "./permission-reason";
import {
  SettingsBadge,
  SettingsEmpty,
  SettingsList,
  SettingsListItem,
  SettingsLoadError,
  SettingsSection,
  SettingsSkeletonRows,
} from "./settings-layout";

/**
 * Everyone in the organization, active or not. Deactivating locks a person
 * out of every workspace, so it goes through a confirmation; reactivating
 * only gives access back and is direct.
 *
 * For someone who manages members, an action refused on one row (the owner,
 * themselves, an admin they may not touch) stays visible but inert, with the
 * reason under the email — the same pattern as "Rời tổ chức". A plain member
 * sees roles as text and no actions: nothing on the list is theirs to change.
 */
export function OrgMembersSection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const { data, isLoading, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } = useOrgMembers(
    orgSlug,
    "all",
  );
  const { canManageMembers, decideChangeRole, decideDeactivate } = usePeoplePermissions(orgSlug);
  const updateRole = useUpdateOrgMemberRole(orgSlug);
  const deactivate = useDeactivateOrgMember(orgSlug);
  const reactivate = useReactivateOrgMember(orgSlug);
  const [query, setQuery] = useState("");
  // The target outlives the dialog's open state, so the title keeps the name
  // while the dialog animates out.
  const [deactivating, setDeactivating] = useState<OrgMember | null>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  // Folded once per page load, not once per member per keystroke.
  const index = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.members).map((member) => ({ member, folded: foldMember(member) })),
    [data],
  );
  const foldedQuery = fold(query);
  const shown = index.filter((entry) => matchesFolded(foldedQuery, entry.folded)).map((entry) => entry.member);
  const count = index.length;
  const manages = canManageMembers.allowed;
  const deactivatingName = deactivating?.display_name || deactivating?.email;

  const onChangeRole = (member: OrgMember, role: string) => {
    if (member.role === role || (updateRole.isPending && updateRole.variables?.userId === member.user_id)) return;
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
        setDeactivateOpen(false);
      },
      onError: (err) => toastApiError(err, t("common.error")),
    });
  };

  const renderList = () => {
    if (isError) {
      return (
        <SettingsList aria-label={t("org.members.title")}>
          <li>
            <SettingsLoadError onRetry={() => void refetch()}>{t("org.members.load_error")}</SettingsLoadError>
          </li>
        </SettingsList>
      );
    }
    return (
      <SettingsList aria-label={t("org.members.title")}>
        {shown.length === 0 ? (
          <li>
            <SettingsEmpty>
              {!query.trim()
                ? t("settings.members.empty")
                : hasNextPage
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
          const roleUpdating = updateRole.isPending && updateRole.variables?.userId === member.user_id;
          // One sentence per row even when both actions are refused for the
          // same reason (the owner, yourself).
          const reasons = manages
            ? [...new Set([decisionReason(t, changeRole), decisionReason(t, toggle)].filter(Boolean))]
            : [];
          const reasonId = `org-member-${member.user_id}-reason`;
          const describedBy = reasons.length > 0 ? reasonId : undefined;
          return (
            <SettingsListItem
              key={member.user_id}
              muted={isDeactivated}
              leading={<ActorAvatar name={name} initials={initials(name)} avatarUrl={member.avatar_url} size="lg" />}
              title={name}
              badge={
                isDeactivated ? (
                  <SettingsBadge tone="warning">{t("org.members.status_deactivated")}</SettingsBadge>
                ) : member.user_id === user?.id ? (
                  <SettingsBadge tone="brand">{t("settings.members.you")}</SettingsBadge>
                ) : null
              }
              meta={
                <>
                  {member.email}
                  {describedBy ? (
                    <span id={reasonId} className="block whitespace-normal text-pretty">
                      {reasons.join(" ")}
                    </span>
                  ) : null}
                </>
              }
              actions={
                <>
                  {changeRole.allowed ? (
                    <div className="w-36">
                      <Select
                        aria-label={t("org.members.change_role")}
                        value={member.role === "admin" ? "admin" : "member"}
                        disabled={roleUpdating}
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
                  {manages && isDeactivated ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-disabled={!toggle.allowed || reactivate.isPending || undefined}
                      aria-describedby={toggle.allowed ? undefined : describedBy}
                      aria-busy={reactivating || undefined}
                      onClick={() => onReactivate(member)}
                    >
                      {t("org.members.reactivate")}
                    </Button>
                  ) : null}
                  {manages && !isDeactivated ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-disabled={!toggle.allowed || undefined}
                      aria-describedby={toggle.allowed ? undefined : describedBy}
                      onClick={() => {
                        setDeactivating(member);
                        setDeactivateOpen(true);
                      }}
                    >
                      {t("org.members.deactivate")}
                    </Button>
                  ) : null}
                </>
              }
            />
          );
        })}
      </SettingsList>
    );
  };

  return (
    <SettingsSection
      title={
        isLoading || isError
          ? null
          : hasNextPage
            ? t("settings.members.count_more", { count })
            : t("settings.members.count", { count })
      }
      action={isLoading || isError ? null : <MemberSearch value={query} onChange={setQuery} />}
    >
      {isLoading ? <SettingsSkeletonRows rows={4} withAvatar /> : renderList()}
      {hasNextPage && !isError ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-disabled={isFetchingNextPage || undefined}
          aria-busy={isFetchingNextPage || undefined}
          onClick={() => void fetchNextPage()}
        >
          {t("people.load_more")}
        </Button>
      ) : null}
      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={(open) => {
          if (!open && !deactivate.isPending) setDeactivateOpen(false);
        }}
        title={t("org.members.deactivate_title", { name: deactivatingName })}
        description={t("org.members.deactivate_body", { name: deactivatingName })}
        confirmLabel={t("org.members.deactivate")}
        onConfirm={confirmDeactivate}
        pending={deactivate.isPending}
      />
    </SettingsSection>
  );
}
