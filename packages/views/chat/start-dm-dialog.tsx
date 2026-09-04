"use client";

import { useState } from "react";
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
import {
  ExternalMemberLookupRow,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

export function StartDmDialog({
  open,
  onOpenChange,
  workspaceId,
  currentUserId,
  contacts,
  onStartDm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  currentUserId: string;
  contacts: ChatContact[];
  onStartDm: (contact: ChatContact) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);

  const { filteredMembers, isLoading, lookup, lookupEnabled, workspaceEmailMatch } =
    useWorkspaceMemberPicker({
      workspaceId,
      currentUserId,
      open,
      query,
      searchSubmitted,
    });

  const resetForm = () => {
    setQuery("");
    setSearchSubmitted(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const pickContact = (contact: ChatContact) => {
    const existing = contacts.find((entry) => entry.user_id === contact.user_id);
    onStartDm(existing ?? contact);
    handleOpenChange(false);
  };

  const submitSearch = () => {
    setSearchSubmitted(true);
    const emailMatch = workspaceEmailMatch;
    if (emailMatch) {
      pickContact(memberToChatContact(emailMatch));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="space-y-1 border-b border-border bg-muted/20 px-5 py-4">
          <DialogTitle>{t("chat.start_dm_title")}</DialogTitle>
          <DialogDescription>{t("chat.start_dm_description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <WorkspaceMemberSearchField
            id="start-dm-search"
            label={t("chat.search_member_or_email")}
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setSearchSubmitted(false);
            }}
            onSubmit={submitSearch}
            placeholder={t("chat.search_member_or_email")}
          />
          <p className="text-caption text-muted-foreground">{t("chat.search_member_or_email_hint")}</p>

          <div className="space-y-2">
            <p className="text-label font-medium text-foreground">{t("chat.workspace_members")}</p>
            <WorkspaceMemberPickerList
              members={filteredMembers}
              loading={isLoading}
              emptyLabel={t("chat.workspace_members_empty")}
              onPick={pickContact}
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
              onPick={pickContact}
              actionLabel={t("chat.start_dm")}
              hint={t("chat.external_member_found")}
            />
          ) : null}
        </div>

        <DialogFooter className="border-t border-border bg-muted/10 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full sm:w-auto"
            onClick={() => handleOpenChange(false)}
          >
            {t("chat.cancel_group")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
