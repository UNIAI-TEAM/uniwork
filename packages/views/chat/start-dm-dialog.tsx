"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatContact } from "@uniwork/core/chat/contacts-store";
import { Dialog } from "@uniwork/ui/components/ui/dialog";
import { FormDialogBody, FormDialogContent, FormDialogHeader } from "../common/form-dialog";
import {
  WorkspaceMemberLookupResult,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

/*
 * Picking a person is the action: a row click opens the conversation, so the
 * dialog has no Cancel/primary footer — the close button and Esc dismiss it.
 */
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

  const { filteredMembers, hasOtherMembers, isLoading, lookup, lookupEnabled, workspaceEmailMatch } =
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
    if (workspaceEmailMatch) {
      pickContact(memberToChatContact(workspaceEmailMatch));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <FormDialogContent size="md">
        <FormDialogHeader title={t("chat.start_dm_title")} description={t("chat.start_dm_description")} />
        <FormDialogBody>
          <WorkspaceMemberSearchField
            id="start-dm-search"
            label={t("chat.member_search_label")}
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setSearchSubmitted(false);
            }}
            onSubmit={submitSearch}
            placeholder={t("chat.member_search_placeholder")}
            hint={t("chat.search_member_or_email_hint")}
          />

          <WorkspaceMemberLookupResult
            enabled={lookupEnabled}
            lookup={lookup}
            onPick={pickContact}
            actionLabel={t("chat.start_dm")}
          />

          <WorkspaceMemberPickerList
            members={filteredMembers}
            loading={isLoading}
            query={query}
            hasOtherMembers={hasOtherMembers}
            actionIcon={
              <MessageCircle
                className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                aria-hidden
              />
            }
            onPick={pickContact}
          />
        </FormDialogBody>
      </FormDialogContent>
    </Dialog>
  );
}
