"use client";

import { Search, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatContactActions, useChatContacts, useLookupChatUser } from "@uniwork/core/chat";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { displayLabelForChatContact } from "@uniwork/core/chat/contacts-store";
import type { GroupChat } from "@uniwork/core/chat/groups-store";
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

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function AddGroupMembersDialog({
  open,
  onOpenChange,
  group,
  currentUserId,
  inviting = false,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: GroupChat;
  currentUserId: string;
  inviting?: boolean;
  onInvite: (members: ChatContact[]) => void;
}) {
  const { t } = useTranslation();
  const contacts = useChatContacts(currentUserId);
  const { addFromLookup } = useChatContactActions(currentUserId);
  const [memberQuery, setMemberQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);

  const normalized = memberQuery.trim().toLowerCase();
  const lookup = useLookupChatUser(normalized, open && searchActive && normalized.includes("@"));
  const existingMemberIds = new Set(group.member_user_ids);

  const resetForm = () => {
    setMemberQuery("");
    setSearchActive(false);
    setPendingMembers([]);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const addMember = (contact: ChatContact) => {
    if (contact.user_id === currentUserId || existingMemberIds.has(contact.user_id)) return;
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

  const pickableContacts = contacts.filter(
    (contact) =>
      contact.user_id !== currentUserId &&
      !existingMemberIds.has(contact.user_id) &&
      !pendingMembers.some((member) => member.user_id === contact.user_id),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="border-b border-border px-4 py-4">
          <DialogTitle>{t("chat.add_group_members_title")}</DialogTitle>
          <DialogDescription>
            {t("chat.add_group_members_description", { name: group.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="add-group-member-search">{t("chat.group_members_label")}</Label>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!normalized.includes("@")) return;
                setSearchActive(true);
              }}
            >
              <Input
                id="add-group-member-search"
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
                  existingMemberIds.has(lookup.data.user_id) ? (
                    <span className="text-caption text-muted-foreground">{t("chat.already_in_group")}</span>
                  ) : (
                    <Button type="button" size="sm" onClick={addFromSearch}>
                      {t("chat.add_to_group")}
                    </Button>
                  )
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

          {pendingMembers.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-border p-2">
              {pendingMembers.map((member) => (
                <li key={member.user_id} className="flex items-center gap-2 rounded-md px-1 py-1">
                  <ActorAvatar
                    name={member.display_name}
                    initials={initialOf(member.display_name)}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1 truncate text-body text-foreground">
                    {displayLabelForChatContact(member)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("chat.remove_member", {
                      name: displayLabelForChatContact(member),
                    })}
                    onClick={() =>
                      setPendingMembers((prev) => prev.filter((entry) => entry.user_id !== member.user_id))
                    }
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-caption text-muted-foreground">{t("chat.add_group_members_hint")}</p>
          )}
        </div>

        <DialogFooter className="border-t border-border px-4 py-4 sm:justify-between">
          <Button type="button" variant="outline" disabled={inviting} onClick={() => handleOpenChange(false)}>
            {t("chat.cancel_group")}
          </Button>
          <Button
            type="button"
            disabled={pendingMembers.length === 0 || inviting}
            onClick={() => onInvite(pendingMembers)}
          >
            {inviting ? t("chat.inviting_members") : t("chat.invite_members")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
