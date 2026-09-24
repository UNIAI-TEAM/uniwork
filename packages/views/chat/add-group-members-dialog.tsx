"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { SelectedMemberChips } from "./selected-member-chips";
import {
  WorkspaceMemberLookupResult,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useMemberPickerFocus,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

/*
 * Same picker as creating a group: workspace members by name or email, and
 * an exact email reaches people outside the workspace. People already in the
 * room never appear in the list.
 */
export function AddGroupMembersDialog({
  open,
  onOpenChange,
  workspaceId,
  group,
  currentUserId,
  contacts,
  inviting = false,
  onInvite,
  variant = "group",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  group: GroupChat;
  currentUserId: string;
  /** Known chat contacts: a picked person reuses their contact record when there is one. */
  contacts: ChatContact[];
  inviting?: boolean;
  onInvite: (members: ChatContact[]) => void;
  /** Channel reuses the same invite API/dialog copy with channel-specific strings. */
  variant?: "group" | "channel";
}) {
  const { t } = useTranslation();
  const [memberQuery, setMemberQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);
  const isChannel = variant === "channel";

  const pickerFocus = useMemberPickerFocus();
  const existingMemberIds = useMemo(() => new Set(group.member_user_ids), [group.member_user_ids]);
  const excludeUserIds = useMemo(
    () => new Set([...group.member_user_ids, ...pendingMembers.map((member) => member.user_id)]),
    [group.member_user_ids, pendingMembers],
  );

  const { filteredMembers, hasOtherMembers, isLoading, lookup, lookupEnabled, workspaceEmailMatch } =
    useWorkspaceMemberPicker({
      workspaceId,
      currentUserId,
      open,
      query: memberQuery,
      searchSubmitted,
      excludeUserIds,
    });

  const resetForm = () => {
    setMemberQuery("");
    setSearchSubmitted(false);
    setPendingMembers([]);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const addMember = (picked: ChatContact) => {
    if (picked.user_id === currentUserId || existingMemberIds.has(picked.user_id)) return;
    const contact = contacts.find((entry) => entry.user_id === picked.user_id) ?? picked;
    setPendingMembers((prev) =>
      prev.some((member) => member.user_id === contact.user_id) ? prev : [...prev, contact],
    );
    setMemberQuery("");
    setSearchSubmitted(false);
    // The picked row leaves the list; the search field is where the next pick starts.
    pickerFocus.focusInput();
  };

  const submitMemberSearch = () => {
    setSearchSubmitted(true);
    if (workspaceEmailMatch && !excludeUserIds.has(workspaceEmailMatch.user_id)) {
      addMember(memberToChatContact(workspaceEmailMatch));
    }
  };

  const alreadyInLabel = isChannel ? t("chat.channel.already_member") : t("chat.already_in_group");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader
          title={isChannel ? t("chat.channel.add_members_title") : t("chat.add_group_members_title")}
          description={
            isChannel
              ? t("chat.channel.add_members_description", { name: group.name })
              : t("chat.add_group_members_description", { name: group.name })
          }
        />
        <FormDialogBody>
          <WorkspaceMemberSearchField
            id="add-group-member-search"
            label={t("chat.group_members_label")}
            query={memberQuery}
            onQueryChange={(value) => {
              setMemberQuery(value);
              setSearchSubmitted(false);
            }}
            onSubmit={submitMemberSearch}
            placeholder={t("chat.member_search_placeholder")}
            hint={t("chat.search_member_or_email_hint")}
            inputRef={pickerFocus.inputRef}
            onArrowDown={pickerFocus.focusFirstRow}
          />

          {pendingMembers.length > 0 ? (
            <SelectedMemberChips
              members={pendingMembers}
              onRemove={(userId) =>
                setPendingMembers((prev) => prev.filter((entry) => entry.user_id !== userId))
              }
              onRemovedLast={pickerFocus.focusInput}
            />
          ) : null}

          <WorkspaceMemberLookupResult
            enabled={lookupEnabled}
            lookup={lookup}
            onPick={addMember}
            actionLabel={isChannel ? t("chat.channel.add_to_channel") : t("chat.add_to_group")}
            unavailableLabel={(userId) => (existingMemberIds.has(userId) ? alreadyInLabel : undefined)}
          />

          <WorkspaceMemberPickerList
            members={filteredMembers}
            loading={isLoading}
            query={memberQuery}
            hasOtherMembers={hasOtherMembers}
            allPickedLabel={
              isChannel ? t("chat.channel.add_members_all_in") : t("chat.add_group_members_all_in")
            }
            onPick={addMember}
            listRef={pickerFocus.listRef}
          />
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          submitLabel={isChannel ? t("chat.channel.invite_members") : t("chat.invite_members")}
          submittingLabel={t("chat.inviting_members")}
          submitting={inviting}
          submitDisabled={pendingMembers.length === 0}
          onSubmit={() => onInvite(pendingMembers)}
          leading={pendingMembers.length === 0 ? t("chat.add_group_members_hint") : undefined}
        />
      </FormDialogContent>
    </Dialog>
  );
}
