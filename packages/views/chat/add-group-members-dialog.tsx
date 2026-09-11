"use client";

import { Search, UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toChatContactFromLookup, useLookupChatUser } from "@uniwork/core/chat";
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
import { SelectedMemberChips } from "./selected-member-chips";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

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
  contacts: ChatContact[];
  inviting?: boolean;
  onInvite: (members: ChatContact[]) => void;
  /** Channel reuses the same invite API/dialog copy with channel-specific strings. */
  variant?: "group" | "channel";
}) {
  const { t } = useTranslation();
  const [memberQuery, setMemberQuery] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);
  const isChannel = variant === "channel";

  const normalized = memberQuery.trim().toLowerCase();
  const lookup = useLookupChatUser(
    workspaceId,
    normalized,
    open && searchActive && normalized.includes("@"),
  );
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
    if (!lookup.data) return;
    addMember(toChatContactFromLookup(lookup.data));
  };

  const pickableContacts = contacts.filter(
    (contact) =>
      contact.user_id !== currentUserId &&
      !existingMemberIds.has(contact.user_id) &&
      !pendingMembers.some((member) => member.user_id === contact.user_id),
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="space-y-1.5 border-b border-border px-5 py-4">
          <DialogTitle className="text-title">
            {isChannel ? t("chat.channel.add_members_title") : t("chat.add_group_members_title")}
          </DialogTitle>
          <DialogDescription>
            {isChannel
              ? t("chat.channel.add_members_description", { name: group.name })
              : t("chat.add_group_members_description", { name: group.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <SelectedMemberChips
            members={pendingMembers}
            onRemove={(userId) =>
              setPendingMembers((prev) => prev.filter((entry) => entry.user_id !== userId))
            }
            emptyLabel={t("chat.add_group_members_hint")}
          />

          <div className="space-y-2">
            <Label htmlFor="add-group-member-search" className="text-label font-medium">
              {t("chat.group_members_label")}
            </Label>
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                if (!normalized.includes("@")) return;
                setSearchActive(true);
              }}
            >
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
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
                className="rounded-xl pl-9"
              />
            </form>

            {searchActive && lookup.isFetching ? (
              <p className="text-caption text-muted-foreground">{t("chat.searching")}</p>
            ) : null}

            {searchActive && !lookup.isFetching && lookup.isFetched && !lookup.data ? (
              <p className="text-caption text-muted-foreground">{t("chat.user_not_found")}</p>
            ) : null}

            {searchActive && lookup.data ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5">
                <ActorAvatar
                  name={lookup.data.display_name}
                  initials={initialOf(lookup.data.display_name)}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-foreground">{lookup.data.display_name}</p>
                  <p className="truncate text-caption text-muted-foreground">{lookup.data.email}</p>
                </div>
                {existingMemberIds.has(lookup.data.user_id) ? (
                  <span className="text-caption text-muted-foreground">
                    {isChannel ? t("chat.channel.already_member") : t("chat.already_in_group")}
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={addFromSearch}>
                    {isChannel ? t("chat.channel.add_to_channel") : t("chat.add_to_group")}
                  </Button>
                )}
              </div>
            ) : null}

            {pickableContacts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-label font-medium text-foreground">{t("chat.group_from_contacts")}</p>
                <ul className="max-h-36 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
                  {pickableContacts.map((contact) => (
                    <li key={contact.user_id}>
                      <button
                        type="button"
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                        onClick={() => addMember(contact)}
                      >
                        <ActorAvatar
                          name={contact.display_name}
                          initials={initialOf(contact.display_name)}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-foreground">
                          {displayLabelForChatContact(contact)}
                        </span>
                        <UserPlus
                          className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                          aria-hidden
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3.5 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={inviting}
            onClick={() => handleOpenChange(false)}
          >
            {t("chat.cancel_group")}
          </Button>
          <Button
            type="button"
            className="rounded-full"
            disabled={pendingMembers.length === 0 || inviting}
            onClick={() => onInvite(pendingMembers)}
          >
            {inviting
              ? t("chat.inviting_members")
              : isChannel
                ? t("chat.channel.invite_members")
                : t("chat.invite_members")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
