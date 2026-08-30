"use client";

import { Search, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatContactActions, useChatContacts, useLookupChatUser } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import { ActorAvatar } from "@uniwork/ui/components/common/actor-avatar";
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
import { cn } from "@uniwork/ui/lib/utils";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  currentUserId,
  creating = false,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  creating?: boolean;
  onCreate: (members: ChatContact[], name: string) => void;
}) {
  const { t } = useTranslation();
  const contacts = useChatContacts(currentUserId);
  const { addFromLookup } = useChatContactActions(currentUserId);
  const [groupName, setGroupName] = useState("");
  const [memberQuery, setMemberQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);

  const normalized = memberQuery.trim().toLowerCase();
  const lookup = useLookupChatUser(normalized, open && searchActive && normalized.includes("@"));

  const resetForm = () => {
    setGroupName("");
    setMemberQuery("");
    setSearchActive(false);
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
    setSearchActive(false);
  };

  const addFromSearch = () => {
    if (!lookup.data?.matrix_ready || !lookup.data.matrix_user_id) return;
    addMember(addFromLookup(lookup.data));
  };

  const removeMember = (userId: string) => {
    setPendingMembers((prev) => prev.filter((member) => member.user_id !== userId));
  };

  const canCreate = pendingMembers.length >= 2 && !creating;

  const submit = () => {
    if (!canCreate) return;
    onCreate(pendingMembers, groupName.trim());
  };

  const pickableContacts = contacts.filter(
    (contact) =>
      contact.user_id !== currentUserId &&
      !pendingMembers.some((member) => member.user_id === contact.user_id),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="border-b border-border px-4 py-4">
          <DialogTitle>{t("chat.create_group_title")}</DialogTitle>
          <DialogDescription>{t("chat.create_group_description")}</DialogDescription>
          <p className="text-caption text-muted-foreground">{t("chat.create_group_one_room_hint")}</p>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{t("chat.group_name_label")}</Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t("chat.group_name_placeholder")}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="group-member-search">{t("chat.group_members_label")}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!normalized.includes("@")) return;
                setSearchActive(true);
              }}
            >
              <Input
                id="group-member-search"
                value={memberQuery}
                onChange={(e) => {
                  setMemberQuery(e.target.value);
                  setSearchActive(false);
                }}
                placeholder={t("chat.search_email_group")}
                type="email"
                autoComplete="off"
              />
              <Button type="submit" variant="outline" size="icon" aria-label={t("chat.search_action")}>
                <Search className="size-4" aria-hidden />
              </Button>
            </form>

            {searchActive && lookup.isFetching ? (
              <p className="text-caption text-muted-foreground">{t("chat.searching")}</p>
            ) : null}

            {searchActive && !lookup.isFetching && lookup.isFetched && !lookup.data ? (
              <p className="text-caption text-muted-foreground">{t("chat.user_not_found")}</p>
            ) : null}

            {searchActive && lookup.data ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                <ActorAvatar
                  name={lookup.data.display_name}
                  initials={initialOf(lookup.data.display_name)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">{lookup.data.display_name}</p>
                  <p className="truncate text-caption text-muted-foreground">{lookup.data.email}</p>
                </div>
                {lookup.data.matrix_ready ? (
                  <Button type="button" size="sm" onClick={addFromSearch}>
                    {t("chat.add_to_group")}
                  </Button>
                ) : (
                  <span className="text-caption text-muted-foreground">{t("chat.matrix_not_ready")}</span>
                )}
              </div>
            ) : null}

            {pickableContacts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-caption text-muted-foreground">{t("chat.group_from_contacts")}</p>
                <ul className="max-h-28 space-y-1 overflow-y-auto rounded-md border border-border p-1">
                  {pickableContacts.map((contact) => (
                    <li key={contact.user_id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                        onClick={() => addMember(contact)}
                      >
                        <ActorAvatar
                          name={contact.display_name}
                          initials={initialOf(contact.display_name)}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-body text-foreground">
                          {displayLabelForChatContact(contact)}
                        </span>
                        <UserPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-label font-medium text-foreground">{t("chat.group_selected_members")}</p>
              <span
                className={cn(
                  "text-caption tabular-nums",
                  pendingMembers.length >= 2 ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t("chat.group_member_minimum", { count: pendingMembers.length })}
              </span>
            </div>

            {pendingMembers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-caption text-muted-foreground">
                {t("chat.group_pick_members")}
              </p>
            ) : (
              <ul className="space-y-1 rounded-md border border-border p-2">
                {pendingMembers.map((member) => (
                  <li
                    key={member.user_id}
                    className="flex items-center gap-2 rounded-md px-1 py-1"
                  >
                    <ActorAvatar
                      name={member.display_name}
                      initials={initialOf(member.display_name)}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">
                        {displayLabelForChatContact(member)}
                      </span>
                      <span className="block truncate text-caption text-muted-foreground">{member.email}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("chat.remove_member", {
                        name: displayLabelForChatContact(member),
                      })}
                      onClick={() => removeMember(member.user_id)}
                    >
                      <X className="size-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-4 py-4 sm:justify-between">
          <Button type="button" variant="outline" disabled={creating} onClick={() => handleOpenChange(false)}>
            {t("chat.cancel_group")}
          </Button>
          <Button type="button" disabled={!canCreate} onClick={submit}>
            {creating ? t("chat.creating_group") : t("chat.start_group")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
