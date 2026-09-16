"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatVoiceRecordingItem } from "@uniwork/core/api/endpoints/chat-voice";
import { useChatVoiceRecordings } from "@uniwork/core/chat";
import { Badge } from "@uniwork/ui/components/ui/badge";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { VoiceCallRecordingDialog } from "./voice-call-recording-dialog";

function formatRecordingWhen(iso: string, locale: string): string {
  if (!iso.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

function startedByLabel(
  startedBy: string,
  currentUserId: string,
  nameContext: NameContextEntry[],
  youLabel: string,
  unknownLabel: string,
): string {
  if (!startedBy) return unknownLabel;
  if (startedBy === currentUserId) return youLabel;
  const match = nameContext.find((entry) => entry.user_id === startedBy);
  return match?.display_name.trim() || unknownLabel;
}

function recordingStatusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case "COMPLETE":
      return t("chat.voice_recordings_status_complete");
    case "PROCESSING":
      return t("chat.voice_recordings_status_processing");
    case "ACTIVE":
      return t("chat.voice_recordings_status_active");
    case "FAILED":
      return t("chat.voice_recordings_status_failed");
    default:
      return status;
  }
}

function recordingStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "COMPLETE":
      return "default";
    case "FAILED":
      return "destructive";
    case "ACTIVE":
      return "secondary";
    default:
      return "outline";
  }
}

function RecordingRow({
  item,
  locale,
  currentUserId,
  nameContext,
  youLabel,
  onPlay,
}: {
  item: ChatVoiceRecordingItem;
  locale: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
  youLabel: string;
  onPlay: (recordingId: string) => void;
}) {
  const { t } = useTranslation();
  const canPlay = item.status === "COMPLETE";

  return (
    <li className="rounded-xl border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-foreground">
            {formatRecordingWhen(item.started_at, locale)}
          </p>
          <p className="mt-0.5 text-caption text-muted-foreground">
            {t("chat.voice_recordings_started_by", {
              name: startedByLabel(
                item.started_by,
                currentUserId,
                nameContext,
                youLabel,
                t("chat.voice_recordings_unknown_member"),
              ),
            })}
          </p>
        </div>
        <Badge variant={recordingStatusVariant(item.status)}>
          {recordingStatusLabel(item.status, t)}
        </Badge>
      </div>
      {item.status === "FAILED" ? (
        <p className="mt-2 text-caption text-muted-foreground">{t("chat.voice_recordings_failed_hint")}</p>
      ) : null}
      {canPlay ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2.5"
          onClick={() => onPlay(item.id)}
        >
          <Play aria-hidden className="size-4" />
          {t("chat.voice_recordings_play")}
        </Button>
      ) : null}
    </li>
  );
}

/** Room-scoped list of voice/video call recordings. */
export function ChatVoiceRecordingsSheet({
  open,
  onOpenChange,
  workspaceId,
  roomId,
  currentUserId,
  nameContext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  roomId: string;
  currentUserId: string;
  nameContext: NameContextEntry[];
}) {
  const { t, i18n } = useTranslation();
  const [playbackId, setPlaybackId] = useState<string | null>(null);
  const { data: recordings = [], isLoading, isError, refetch } = useChatVoiceRecordings(
    workspaceId,
    roomId,
    open,
  );

  const sorted = useMemo(
    () => [...recordings].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [recordings],
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>{t("chat.voice_recordings_title")}</SheetTitle>
            <SheetDescription>{t("chat.voice_recordings_description")}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {isLoading ? (
              <div className="flex items-center gap-2 px-1 text-caption text-muted-foreground">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                <span>{t("chat.voice_recordings_loading")}</span>
              </div>
            ) : null}
            {isError ? (
              <div className="flex flex-col gap-2 px-1">
                <p className="text-caption text-destructive">{t("chat.voice_recordings_load_failed")}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                  {t("chat.retry")}
                </Button>
              </div>
            ) : null}
            {!isLoading && !isError && sorted.length === 0 ? (
              <p className="px-1 text-caption text-muted-foreground">{t("chat.voice_recordings_empty")}</p>
            ) : null}
            <ul className="space-y-2">
              {sorted.map((item) => (
                <RecordingRow
                  key={item.id}
                  item={item}
                  locale={i18n.language}
                  currentUserId={currentUserId}
                  nameContext={nameContext}
                  youLabel={t("chat.you")}
                  onPlay={setPlaybackId}
                />
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
      {playbackId ? (
        <VoiceCallRecordingDialog
          open
          onOpenChange={(next) => {
            if (!next) setPlaybackId(null);
          }}
          workspaceId={workspaceId}
          roomId={roomId}
          recordingId={playbackId}
        />
      ) : null}
    </>
  );
}
