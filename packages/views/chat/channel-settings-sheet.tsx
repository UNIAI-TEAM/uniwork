"use client";

import { Archive, Hash, Lock, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import {
  useArchiveChatChannel,
  useUnarchiveChatChannel,
  useUpdateChatChannel,
} from "@uniwork/core/chat";
import { useProjects } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { ChannelSettingsMembers } from "./channel-settings-members";
import { ChatSettingsTitleRow } from "./chat-settings-ui";
import { LeaveConversationSection } from "./leave-conversation-section";

export function ChannelSettingsSheet({
  open,
  onOpenChange,
  workspaceId,
  channel,
  currentUserId,
  youLabel,
  onArchived,
  onAddMembers,
  onLeave,
  leaving,
  leaveDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  channel: ChatRoomRecord;
  currentUserId: string;
  youLabel: string;
  onArchived?: () => void;
  onAddMembers?: () => void;
  onLeave?: () => void | Promise<void>;
  leaving?: boolean;
  leaveDisabled?: boolean;
}) {
  const { t } = useTranslation();
  const updateChannel = useUpdateChatChannel(workspaceId);
  const archiveChannel = useArchiveChatChannel(workspaceId);
  const unarchiveChannel = useUnarchiveChatChannel(workspaceId);
  const { data: projectList } = useProjects(workspaceId);
  const projects = projectList?.projects ?? [];

  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [visibility, setVisibility] = useState(channel.visibility === "private" ? "private" : "public");
  const [projectId, setProjectId] = useState(channel.project_id ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setVisibility(channel.visibility === "private" ? "private" : "public");
    setProjectId(channel.project_id ?? "");
  }, [open, channel]);

  const isDefault = Boolean(channel.is_default);
  const saving = updateChannel.isPending || busy;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    const nextProject = projectId || null;
    const prevProject = channel.project_id || null;
    setBusy(true);
    void updateChannel
      .mutateAsync({
        roomId: channel.id,
        name: trimmed !== channel.name ? trimmed : undefined,
        topic: topic.trim() !== (channel.topic ?? "") ? topic.trim() : undefined,
        visibility:
          !isDefault && visibility !== (channel.visibility ?? "public") ? visibility : undefined,
        project_id: nextProject !== prevProject ? nextProject : undefined,
      })
      .then((room) => {
        if (room) onOpenChange(false);
      })
      .finally(() => setBusy(false));
  };

  const handleArchive = () => {
    if (isDefault || archiveChannel.isPending) return;
    void archiveChannel.mutateAsync(channel.id).then((ok) => {
      if (!ok) return;
      onOpenChange(false);
      onArchived?.();
    });
  };

  const handleUnarchive = () => {
    if (unarchiveChannel.isPending) return;
    void unarchiveChannel.mutateAsync(channel.id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="sr-only">
          <SheetTitle>{t("chat.channel.settings_title")}</SheetTitle>
          <SheetDescription>{t("chat.channel.settings_description")}</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <ChatSettingsTitleRow title={`#${channel.name}`} />

          <div className="space-y-5 px-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="channel-settings-name">{t("chat.channel.name_label")}</Label>
              <Input
                id="channel-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-xl"
                maxLength={80}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel-settings-topic">{t("chat.channel.topic_label")}</Label>
              <Textarea
                id="channel-settings-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
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
                  <RadioGroupItem value="public" id="channel-settings-public" disabled={isDefault} />
                  <Hash className="size-4 text-muted-foreground" aria-hidden />
                  <span className="text-body">{t("chat.channel.visibility_public")}</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2">
                  <RadioGroupItem value="private" id="channel-settings-private" disabled={isDefault} />
                  <Lock className="size-4 text-muted-foreground" aria-hidden />
                  <span className="text-body">{t("chat.channel.visibility_private")}</span>
                </label>
              </RadioGroup>
              {isDefault ? (
                <p className="text-caption text-muted-foreground">
                  {t("chat.channel.default_visibility_locked")}
                </p>
              ) : null}
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

            <Button type="button" className="w-full rounded-full" disabled={saving} onClick={save}>
              {saving ? t("chat.channel.saving") : t("chat.channel.save")}
            </Button>

            {!isDefault && onAddMembers ? (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-full"
                onClick={() => {
                  onOpenChange(false);
                  onAddMembers();
                }}
              >
                <UserPlus className="size-4" aria-hidden />
                {t("chat.channel.add_members")}
              </Button>
            ) : null}

            {!isDefault ? (
              <div className="rounded-xl border border-border p-3">
                <p className="mb-2 text-label font-medium text-foreground">
                  {t("chat.channel.archive_section")}
                </p>
                <p className="mb-3 text-caption text-muted-foreground">
                  {t("chat.channel.archive_hint")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    disabled={archiveChannel.isPending}
                    onClick={handleArchive}
                  >
                    <Archive className="size-4" aria-hidden />
                    {t("chat.channel.archive")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full"
                    disabled={unarchiveChannel.isPending}
                    onClick={handleUnarchive}
                  >
                    {t("chat.channel.unarchive")}
                  </Button>
                </div>
              </div>
            ) : null}

            {!isDefault ? (
              <ChannelSettingsMembers
                open={open}
                workspaceId={workspaceId}
                roomId={channel.id}
                currentUserId={currentUserId}
                youLabel={youLabel}
              />
            ) : null}

            {!isDefault && onLeave ? (
              <div className="px-0 pb-2">
                <LeaveConversationSection
                  variant="channel"
                  disabled={leaveDisabled}
                  leaving={leaving}
                  onLeave={onLeave}
                />
              </div>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
