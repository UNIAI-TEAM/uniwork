"use client";

import { Archive, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
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
import { ChatSettingsMenuRow, ChatSettingsTitleRow } from "./chat-settings-ui";
import { ConfirmDialog } from "../common/form-dialog";
import { toastApiError } from "../toast-api-error";
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
  onOpenSearch,
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
  onOpenSearch?: () => void;
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
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(channel.name);
    setTopic(channel.topic ?? "");
    setVisibility(channel.visibility === "private" ? "private" : "public");
    setProjectId(channel.project_id ?? "");
  }, [open, channel]);

  const isDefault = Boolean(channel.is_default);
  const saving = updateChannel.isPending || busy;
  // Save appears once something changed, so an untouched sheet reads as
  // information, not as a form waiting to be submitted.
  const dirty =
    name.trim() !== channel.name ||
    topic.trim() !== (channel.topic ?? "") ||
    (!isDefault && visibility !== (channel.visibility === "private" ? "private" : "public")) ||
    (projectId || null) !== (channel.project_id || null);

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
      .catch((err: unknown) => toastApiError(err, t("chat.channel.save_failed")))
      .finally(() => setBusy(false));
  };

  // Archived channels leave every list, so the sheet only ever sees an
  // active one: archiving asks first, then offers an undo in the toast.
  const handleArchive = () => {
    if (isDefault || archiveChannel.isPending) return;
    void archiveChannel
      .mutateAsync(channel.id)
      .then((ok) => {
        if (!ok) return;
        setArchiveConfirmOpen(false);
        onOpenChange(false);
        onArchived?.();
        toast.success(t("chat.channel.archived_toast", { name: channel.name }), {
          action: {
            label: t("chat.channel.unarchive"),
            onClick: () => {
              void unarchiveChannel
                .mutateAsync(channel.id)
                .catch((err: unknown) => toastApiError(err, t("chat.channel.unarchive_failed")));
            },
          },
        });
      })
      .catch((err: unknown) => toastApiError(err, t("chat.channel.archive_failed")));
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

          {onOpenSearch ? (
            <section className="border-b border-border py-1">
              <ChatSettingsMenuRow
                icon={Search}
                label={t("chat.search_messages")}
                onClick={() => {
                  onOpenChange(false);
                  onOpenSearch();
                }}
              />
            </section>
          ) : null}

          <form
            id="channel-settings-form"
            className="space-y-4 border-b border-border px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="channel-settings-name">{t("chat.channel.name_label")}</Label>
              <Input
                id="channel-settings-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="channel-settings-topic">{t("chat.channel.topic_label")}</Label>
              <Textarea
                id="channel-settings-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="min-h-16"
                maxLength={280}
              />
            </div>

            <div className="space-y-1.5">
              <Label id="channel-settings-visibility-label">{t("chat.channel.visibility_label")}</Label>
              <RadioGroup
                aria-labelledby="channel-settings-visibility-label"
                value={visibility}
                onValueChange={(value) => {
                  if (value === "public" || value === "private") setVisibility(value);
                }}
                className="gap-1.5"
              >
                {(["public", "private"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2 transition-colors duration-(--duration-fast) hover:bg-surface-hover has-[[data-checked]]:border-ring has-[[data-checked]]:bg-surface-selected"
                  >
                    <RadioGroupItem value={value} id={`channel-settings-${value}`} disabled={isDefault} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-foreground">
                        {t(`chat.channel.visibility_${value}_title`)}
                      </span>
                      <span className="block text-caption text-muted-foreground">
                        {t(`chat.channel.visibility_${value}_hint`)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {isDefault ? (
                <p className="text-caption text-muted-foreground">{t("chat.channel.default_visibility_locked")}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label id="channel-settings-project-label">{t("chat.channel.project_label")}</Label>
              <Select
                value={projectId || "__none__"}
                onValueChange={(value) => setProjectId(!value || value === "__none__" ? "" : value)}
                items={[
                  { value: "__none__", label: t("chat.channel.project_none") },
                  ...projects.map((project) => ({ value: project.id, label: project.title })),
                ]}
              >
                <SelectTrigger className="w-full" aria-labelledby="channel-settings-project-label">
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
          </form>

          {!isDefault && onAddMembers ? (
            <section className="border-b border-border py-1">
              <ChatSettingsMenuRow
                icon={UserPlus}
                label={t("chat.channel.add_members")}
                onClick={() => {
                  onOpenChange(false);
                  onAddMembers();
                }}
              />
            </section>
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

          {!isDefault ? (
            <div className="space-y-4 px-4 py-4">
              <section className="space-y-2">
                <h3 className="text-label font-semibold text-foreground">{t("chat.channel.archive_section")}</h3>
                <p className="text-caption text-pretty text-muted-foreground">{t("chat.channel.archive_hint")}</p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={archiveChannel.isPending}
                  onClick={() => setArchiveConfirmOpen(true)}
                >
                  <Archive aria-hidden />
                  {t("chat.channel.archive")}
                </Button>
              </section>
              {onLeave ? (
                <LeaveConversationSection
                  variant="channel"
                  disabled={leaveDisabled}
                  leaving={leaving}
                  onLeave={onLeave}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        {dirty ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface px-4 py-3">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setName(channel.name);
                setTopic(channel.topic ?? "");
                setVisibility(channel.visibility === "private" ? "private" : "public");
                setProjectId(channel.project_id ?? "");
              }}
            >
              {t("chat.channel.discard_changes")}
            </Button>
            <Button type="submit" form="channel-settings-form" disabled={saving || !name.trim()}>
              {saving ? t("chat.channel.saving") : t("chat.channel.save")}
            </Button>
          </div>
        ) : null}

        <ConfirmDialog
          open={archiveConfirmOpen}
          onOpenChange={setArchiveConfirmOpen}
          title={t("chat.channel.archive_confirm_title", { name: channel.name })}
          description={t("chat.channel.archive_hint")}
          confirmLabel={t("chat.channel.archive")}
          pending={archiveChannel.isPending}
          onConfirm={handleArchive}
        />
      </SheetContent>
    </Sheet>
  );
}
