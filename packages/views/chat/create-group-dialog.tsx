"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
import { Badge } from "@uniwork/ui/components/ui/badge";
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
import {
  ExternalMemberLookupRow,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

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
        <DialogHeader className="space-y-1 border-b border-border bg-muted/20 px-5 py-4">
          <DialogTitle>{t("chat.create_group_title")}</DialogTitle>
          <DialogDescription>{t("chat.create_group_description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{t("chat.group_name_label")}</Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t("chat.group_name_placeholder")}
              className="rounded-xl"
              autoFocus
            />
          </div>

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
              <p className="text-caption text-muted-foreground">{t("chat.workspace_members")}</p>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-label font-medium text-foreground">{t("chat.group_selected_members")}</p>
              <Badge
                variant={pendingMembers.length >= 2 ? "default" : "secondary"}
                className="tabular-nums"
              >
                {t("chat.group_member_minimum", { count: pendingMembers.length })}
              </Badge>
            </div>

            {pendingMembers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-8 text-center text-caption text-muted-foreground">
                {t("chat.group_pick_members")}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {pendingMembers.map((member) => (
                  <li key={member.user_id}>
                    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2 shadow-sm">
                      <ActorAvatar
                        name={member.display_name}
                        initials={initialOf(member.display_name)}
                        size="sm"
                      />
                      <span className="min-w-0 truncate text-caption font-medium text-foreground">
                        {displayLabelForChatContact(member)}
                      </span>
                      <button
                        type="button"
                        className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={t("chat.remove_member", {
                          name: displayLabelForChatContact(member),
                        })}
                        onClick={() => removeMember(member.user_id)}
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-caption text-muted-foreground">{t("chat.create_group_one_room_hint")}</p>
        </div>

        <DialogFooter className="border-t border-border bg-muted/10 px-5 py-4 sm:justify-between">
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
