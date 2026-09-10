"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useCreateChatChannel } from "@uniwork/core/chat";
import { useProjects } from "@uniwork/core/tasks";
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
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uniwork/ui/components/ui/select";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import {
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { memberToChatContact } from "./workspace-member-picker-utils";

function initialOf(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

export function CreateChannelDialog({
  open,
  onOpenChange,
  workspaceId,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  currentUserId: string;
  onCreated?: (room: ChatRoomRecord) => void;
}) {
  const { t } = useTranslation();
  const createChannel = useCreateChatChannel(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const projects = projectList?.projects ?? [];

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [projectId, setProjectId] = useState<string>("");
  const [memberQuery, setMemberQuery] = useState("");
  const [searchSubmitted, setSearchSubmitted] = useState(false);
  const [pendingMembers, setPendingMembers] = useState<ChatContact[]>([]);

  const excludeUserIds = useMemo(
    () => new Set(pendingMembers.map((member) => member.user_id)),
    [pendingMembers],
  );

  const { filteredMembers, isLoading, workspaceEmailMatch } = useWorkspaceMemberPicker({
    workspaceId,
    currentUserId,
    open,
    query: memberQuery,
    searchSubmitted,
    excludeUserIds,
  });

  const resetForm = () => {
    setName("");
    setTopic("");
    setVisibility("public");
    setProjectId("");
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

  const trimmedName = name.trim();
  const canCreate = trimmedName.length >= 1 && trimmedName.length <= 80 && !createChannel.isPending;

  const submit = () => {
    if (!canCreate) return;
    void createChannel
      .mutateAsync({
        name: trimmedName,
        visibility,
        topic: topic.trim() || undefined,
        project_id: projectId || undefined,
        member_user_ids: pendingMembers.map((m) => m.user_id),
      })
      .then((room) => {
        if (!room?.id) return;
        handleOpenChange(false);
        onCreated?.(room);
      });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton>
        <DialogHeader className="space-y-1 border-b border-border bg-muted/20 px-5 py-4">
          <DialogTitle>{t("chat.channel.create_title")}</DialogTitle>
          <DialogDescription>{t("chat.channel.create_description")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="channel-name">{t("chat.channel.name_label")}</Label>
            <Input
              id="channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("chat.channel.name_placeholder")}
              className="rounded-xl"
              autoFocus
              maxLength={80}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-topic">{t("chat.channel.topic_label")}</Label>
            <Textarea
              id="channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("chat.channel.topic_placeholder")}
              className="min-h-16 rounded-xl"
              maxLength={280}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("chat.channel.visibility_label")}</Label>
            <RadioGroup
              value={visibility}
              onValueChange={(value) => {
                if (value === "public" || value === "private") setVisibility(value);
              }}
              className="gap-2"
            >
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2">
                <RadioGroupItem value="public" id="channel-vis-public" />
                <span className="text-body text-foreground">{t("chat.channel.visibility_public")}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2">
                <RadioGroupItem value="private" id="channel-vis-private" />
                <span className="text-body text-foreground">{t("chat.channel.visibility_private")}</span>
              </label>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>{t("chat.channel.project_label")}</Label>
            <Select
              value={projectId || "__none__"}
              onValueChange={(value) => setProjectId(!value || value === "__none__" ? "" : value)}
              items={[
                { value: "__none__", label: t("chat.channel.project_none") },
                ...projects.map((project) => ({ value: project.id, label: project.title })),
              ]}
            >
              <SelectTrigger className="w-full rounded-xl" aria-label={t("chat.channel.project_label")}>
                <SelectValue placeholder={t("chat.channel.project_none")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("chat.channel.project_none")}</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <WorkspaceMemberSearchField
              id="channel-member-search"
              label={t("chat.channel.members_label")}
              query={memberQuery}
              onQueryChange={(value) => {
                setMemberQuery(value);
                setSearchSubmitted(false);
              }}
              onSubmit={submitMemberSearch}
              placeholder={t("chat.search_member_or_email")}
            />
            <WorkspaceMemberPickerList
              members={filteredMembers}
              loading={isLoading}
              emptyLabel={t("chat.workspace_members_empty")}
              onPick={addMember}
            />
            {pendingMembers.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {pendingMembers.map((member) => (
                  <li key={member.user_id}>
                    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-2">
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
                        ×
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/10 px-5 py-4 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            disabled={createChannel.isPending}
            onClick={() => handleOpenChange(false)}
          >
            {t("chat.channel.cancel")}
          </Button>
          <Button type="button" className="rounded-full" disabled={!canCreate} onClick={submit}>
            {createChannel.isPending ? t("chat.channel.creating") : t("chat.channel.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
