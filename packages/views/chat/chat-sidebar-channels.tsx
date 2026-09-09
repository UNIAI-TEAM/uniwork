"use client";

import { Hash, Lock, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { useProjects } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { ChannelDirectorySheet } from "./channel-directory-sheet";
import type { ChatRoomPreview } from "./chat-sidebar-preview";
import { SidebarNavItem } from "./chat-sidebar-rows";
import { CreateChannelDialog } from "./create-channel-dialog";

export function ChatSidebarChannels({
  workspaceId,
  currentUserId,
  channels,
  activeChannelId,
  onSelectChannel,
  unreadByRoomId = {},
  mentionUnreadByRoomId = {},
  roomPreviewsByRoomId = {},
  unreadBadgesReady = false,
  youLabel,
  voiceCallLabel,
  voiceMessageLabel,
  fileMessageLabel,
  yesterdayLabel,
}: {
  workspaceId: string;
  currentUserId: string;
  channels: ChatRoomRecord[];
  activeChannelId: string | null;
  onSelectChannel: (channel: ChatRoomRecord) => void;
  unreadByRoomId?: Record<string, number>;
  mentionUnreadByRoomId?: Record<string, number>;
  roomPreviewsByRoomId?: Record<string, ChatRoomPreview>;
  unreadBadgesReady?: boolean;
  youLabel: string;
  voiceCallLabel: string;
  voiceMessageLabel: string;
  fileMessageLabel?: string;
  yesterdayLabel: string;
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const { data: projectList } = useProjects(workspaceId);
  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectList?.projects ?? []) map.set(p.id, p.title);
    return map;
  }, [projectList?.projects]);

  const grouped = useMemo(() => {
    const byProject = new Map<string, ChatRoomRecord[]>();
    const ungrouped: ChatRoomRecord[] = [];
    for (const ch of channels) {
      const pid = ch.project_id?.trim();
      if (!pid) {
        ungrouped.push(ch);
        continue;
      }
      const list = byProject.get(pid) ?? [];
      list.push(ch);
      byProject.set(pid, list);
    }
    const sections: { key: string; title: string; rooms: ChatRoomRecord[] }[] = [];
    for (const [pid, rooms] of byProject) {
      sections.push({
        key: pid,
        title: projectNameById.get(pid) ?? pid,
        rooms: rooms.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    sections.sort((a, b) => a.title.localeCompare(b.title));
    const hasProjectSections = sections.length > 0;
    if (ungrouped.length > 0) {
      sections.push({
        key: "__none__",
        // Flat list when nothing is project-linked — avoid a "No project" caption.
        title: hasProjectSections ? t("chat.channel.ungrouped") : "",
        rooms: ungrouped.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    return sections;
  }, [channels, projectNameById, t]);

  const memberIds = useMemo(() => new Set(channels.map((c) => c.id)), [channels]);

  return (
    <section className="flex min-h-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
          {t("chat.channel.section_title")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("chat.channel.directory_aria")}
            onClick={() => setDirectoryOpen(true)}
          >
            <Search className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={t("chat.channel.create_aria")}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {grouped.map((section) => (
        <div key={section.key} className="space-y-0.5">
          {section.title ? (
            <p className="px-1 text-caption text-muted-foreground">{section.title}</p>
          ) : null}
          {section.rooms.map((channel) => {
            const privateChannel = channel.visibility === "private";
            return (
              <SidebarNavItem
                key={channel.id}
                active={activeChannelId === channel.id}
                onClick={() => onSelectChannel(channel)}
                avatar={
                  <span
                    className="flex size-9 shrink-0 items-center justify-center text-muted-foreground"
                    aria-hidden
                  >
                    {privateChannel ? <Lock className="size-4" /> : <Hash className="size-4" />}
                  </span>
                }
                title={privateChannel ? channel.name : `#${channel.name}`}
                preview={roomPreviewsByRoomId[channel.id]}
                roomId={channel.id}
                contacts={[]}
                previewOptions={{
                  currentUserId,
                  isGroup: true,
                  youLabel,
                  voiceCallLabel,
                  voiceMessageLabel,
                  fileMessageLabel,
                  yesterdayLabel,
                }}
                unread={unreadByRoomId[channel.id] ?? 0}
                mentionUnread={mentionUnreadByRoomId[channel.id] ?? 0}
                unreadBadgesReady={unreadBadgesReady}
              />
            );
          })}
        </div>
      ))}

      <CreateChannelDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        onCreated={(room) => {
          setCreateOpen(false);
          onSelectChannel(room);
        }}
      />
      <ChannelDirectorySheet
        open={directoryOpen}
        onOpenChange={setDirectoryOpen}
        workspaceId={workspaceId}
        memberChannelIds={memberIds}
        onJoined={(room) => {
          setDirectoryOpen(false);
          onSelectChannel(room);
        }}
      />
    </section>
  );
}
