"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { SelectedMemberChips } from "./selected-member-chips";
import {
  ExternalMemberLookupRow,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

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
  onCreate: (members: ChatContact[], name: string) => void;
}) {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);

  const excludeUserIds = useMemo(
    () => new Set(pendingMembers.map((member) => member.user_id)),
    [pendingMembers],
  );

  const { filteredMembers, isLoading, lookup, lookupEnabled, workspaceEmailMatch } =
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

  const canCreate = pendingMembers.length >= 2 && !creating;

  const submit = () => {
    if (!canCreate) return;
    onCreate(pendingMembers, groupName.trim());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="space-y-1.5 border-b border-border px-5 py-4">
          <DialogTitle className="text-title">{t("chat.create_group_title")}</DialogTitle>
          <DialogDescription>{t("chat.create_group_description")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name" className="text-label font-medium">
              {t("chat.group_name_label")}
            </Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t("chat.group_name_placeholder")}
              className="rounded-xl"
              autoFocus
            />
          </div>

          <SelectedMemberChips
            members={pendingMembers}
            onRemove={removeMember}
            title={t("chat.group_selected_members")}
            countBadge={t("chat.group_member_minimum", { count: pendingMembers.length })}
            emptyLabel={t("chat.group_pick_members")}
          />

          <div className="space-y-3">
            <WorkspaceMemberSearchField
              id="group-member-search"
              label={t("chat.group_members_label")}
              query={memberQuery}
              onQueryChange={(value) => {
                setMemberQuery(value);
                setSearchSubmitted(false);
              }}
              onSubmit={submitMemberSearch}
              placeholder={t("chat.search_member_or_email")}
            />
            <p className="text-caption text-muted-foreground">{t("chat.search_member_or_email_hint")}</p>

            <div className="space-y-2">
              <p className="text-label font-medium text-foreground">{t("chat.workspace_members")}</p>
              <WorkspaceMemberPickerList
                members={filteredMembers}
                loading={isLoading}
                emptyLabel={t("chat.workspace_members_empty")}
                onPick={addMember}
              />
            </div>

            {lookupEnabled && lookup.isFetching ? (
              <p className="text-caption text-muted-foreground">{t("chat.searching")}</p>
            ) : null}

            {lookupEnabled && !lookup.isFetching && lookup.isFetched && !lookup.data ? (
              <p className="text-caption text-muted-foreground">{t("chat.user_not_found")}</p>
            ) : null}

            {lookupEnabled && lookup.data ? (
              <ExternalMemberLookupRow
                lookup={lookup.data}
                onPick={(contact) => addMember(contact)}
                actionLabel={t("chat.add_to_group")}
                hint={t("chat.external_member_found")}
              />
            ) : null}
          </div>

          <p className="text-caption text-muted-foreground">{t("chat.create_group_one_room_hint")}</p>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3.5 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={creating}
            onClick={() => handleOpenChange(false)}
          >
            {t("chat.cancel_group")}
          </Button>
          <Button type="button" className="rounded-full" disabled={!canCreate} onClick={submit}>
            {creating ? t("chat.creating_group") : t("chat.start_group")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
