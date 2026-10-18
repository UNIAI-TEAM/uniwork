"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import {
  FormDialogBody,
  FormDialogContent,
  FormDialogFooter,
  FormDialogHeader,
} from "../common/form-dialog";
import { CHAT_DIALOG_CLASS } from "./chat-dialog-look";
import { ChatGroupAvatarPicker } from "./chat-group-avatar-editor";
import { SelectedMemberChips } from "./selected-member-chips";
import {
  WorkspaceMemberLookupResult,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useMemberPickerFocus,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

const MIN_GROUP_MEMBERS = 2;

export function CreateGroupDialog({
  open,
  onOpenChange,
  workspaceId,
  currentUserId,
  creating = false,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  currentUserId: string;
  creating?: boolean;
  /** `avatar` is uploaded by the caller once the group exists. */
  onCreate: (members: ChatContact[], name: string, avatar: File | null) => void;
}) {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);
  const [avatar, setAvatar] = useState<File | null>(null);

  const pickerFocus = useMemberPickerFocus();
  const excludeUserIds = useMemo(
    () => new Set(pendingMembers.map((member) => member.user_id)),
    [pendingMembers],
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
    setGroupName("");
    setMemberQuery("");
    setSearchSubmitted(false);
    setPendingMembers([]);
    setAvatar(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const addMember = (contact: ChatContact) => {
    if (contact.user_id === currentUserId) return;
    setPendingMembers((prev) =>
      prev.some((member) => member.user_id === contact.user_id) ? prev : [...prev, contact],
    );
    setMemberQuery("");
    setSearchSubmitted(false);
    // The picked row leaves the list; the search field is where the next pick starts.
    pickerFocus.focusInput();
  };

  const removeMember = (userId: string) => {
    setPendingMembers((prev) => prev.filter((member) => member.user_id !== userId));
  };

  const submitMemberSearch = () => {
    setSearchSubmitted(true);
    if (workspaceEmailMatch) {
      addMember(memberToChatContact(workspaceEmailMatch));
    }
  };

  const picked = pendingMembers.length;
  const missing = Math.max(MIN_GROUP_MEMBERS - picked, 0);
  const canCreate = missing === 0 && !creating;

  const submit = () => {
    if (!canCreate) return;
    onCreate(pendingMembers, groupName.trim(), avatar);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md" className={`${CHAT_DIALOG_CLASS} sm:max-w-xl`}>
        <FormDialogHeader
          title={t("chat.create_group_title")}
          description={t("chat.create_group_description")}
        />
        <FormDialogBody>
          <div className="flex items-center gap-5">
            <ChatGroupAvatarPicker file={avatar} onFileChange={setAvatar} />
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="group-name" className="text-label font-semibold">
                {t("chat.group_name_optional_label")}
              </Label>
              <Input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder={t("chat.group_name_placeholder")}
                maxLength={80}
                autoFocus
              />
            </div>
          </div>

          <SelectedMemberChips
            members={pendingMembers}
            onRemove={removeMember}
            onRemovedLast={pickerFocus.focusInput}
            title={t("chat.group_selected_members")}
            // How many are still missing is said once, next to the submit button.
            summary={t("chat.group_member_selected", { count: picked })}
          />

          <WorkspaceMemberSearchField
            id="group-member-search"
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

          <WorkspaceMemberLookupResult
            enabled={lookupEnabled}
            lookup={lookup}
            onPick={addMember}
            actionLabel={t("chat.add_to_group")}
          />

          <WorkspaceMemberPickerList
            members={filteredMembers}
            loading={isLoading}
            query={memberQuery}
            hasOtherMembers={hasOtherMembers}
            onPick={addMember}
            listRef={pickerFocus.listRef}
          />
        </FormDialogBody>
        <FormDialogFooter
          onCancel={() => handleOpenChange(false)}
          cancelVariant="secondary"
          submitLabel={t("chat.start_group")}
          submittingLabel={t("chat.creating_group")}
          submitting={creating}
          submitDisabled={missing > 0}
          onSubmit={submit}
          leading={missing > 0 ? t("chat.group_member_missing", { count: missing }) : undefined}
        />
      </FormDialogContent>
    </Dialog>
  );
}
