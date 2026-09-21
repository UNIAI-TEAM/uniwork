"use client";

import { AudioLines, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatVoiceRecordingItem } from "@uniwork/core/api/endpoints/chat-voice";
import { useChatVoiceRecordings } from "@uniwork/core/chat";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@uniwork/ui/components/ui/empty";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@uniwork/ui/components/ui/sheet";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { moduleTone } from "../layout/module-tones";
import { formatMessageDateTime, formatMessageDay, formatMessageTime } from "./chat-message-time";
import type { NameContextEntry } from "./native-chat-message-mapping";
import { formatVoiceCallDuration } from "./voice-call-duration";
import { VoiceCallRecordingDialog } from "./voice-call-recording-dialog";

function parseTs(iso: string): number | null {
  if (!iso.trim()) return null;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? null : ts;
}

/** Length of a finished recording, or null while it is still running / unknown. */
export function recordingDurationSeconds(item: Pick<ChatVoiceRecordingItem, "started_at" | "ended_at">): number | null {
  const start = parseTs(item.started_at);
  const end = parseTs(item.ended_at);
  if (start === null || end === null || end <= start) return null;
  return Math.round((end - start) / 1000);
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

type RecordingStatus = "complete" | "processing" | "active" | "failed" | "unknown";

/** Server statuses are a lenient string; anything new reads as a translated "unknown". */
export function recordingStatus(status: string): RecordingStatus {
  switch (status.trim().toUpperCase()) {
    case "COMPLETE":
      return "complete";
    case "PROCESSING":
      return "processing";
    case "ACTIVE":
      return "active";
    case "FAILED":
      return "failed";
    default:
      return "unknown";
  }
}

const STATUS_LABEL_KEY: Record<RecordingStatus, string> = {
  complete: "chat.voice_recordings_status_complete",
  processing: "chat.voice_recordings_status_processing",
  active: "chat.voice_recordings_status_active",
  failed: "chat.voice_recordings_status_failed",
  unknown: "chat.voice_recordings_status_unknown",
};

const STATUS_TONE: Record<RecordingStatus, string> = {
  complete: "bg-success-soft text-success-soft-foreground",
  processing: "bg-info-soft text-info-soft-foreground",
  active: "bg-brand-subtle text-brand-subtle-foreground",
  failed: "bg-destructive-soft text-destructive-soft-foreground",
  unknown: "bg-muted text-muted-foreground",
};

function RecordingStatusPill({ status }: { status: RecordingStatus }) {
  const { t } = useTranslation();
  return (
    <span
      data-status={status}
      className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-micro font-semibold", STATUS_TONE[status])}
    >
      {t(STATUS_LABEL_KEY[status])}
    </span>
  );
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
  const status = recordingStatus(item.status);
  const startedTs = parseTs(item.started_at);
  const duration = recordingDurationSeconds(item);
  const who = startedByLabel(
    item.started_by,
    currentUserId,
    nameContext,
    youLabel,
    t("chat.voice_recordings_unknown_member"),
  );

  return (
    <li className="rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors duration-(--duration-fast) hover:bg-surface-hover">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-foreground tabular-nums">
            {startedTs === null ? (
              t("chat.voice_recordings_unknown_time")
            ) : (
              <time dateTime={new Date(startedTs).toISOString()} title={formatMessageDateTime(startedTs, locale)}>
                {t("chat.voice_recordings_when", {
                  day: formatMessageDay(startedTs, locale, {
                    today: t("chat.day_today"),
                    yesterday: t("chat.sidebar_yesterday"),
                  }),
                  time: formatMessageTime(startedTs, locale),
                })}
              </time>
            )}
          </p>
          <p className="mt-0.5 truncate text-caption text-muted-foreground tabular-nums">
            {t("chat.voice_recordings_started_by", { name: who })}
            {duration !== null
              ? ` · ${t("chat.voice_recordings_duration", { duration: formatVoiceCallDuration(duration) })}`
              : null}
          </p>
        </div>
        <RecordingStatusPill status={status} />
      </div>
      {status === "failed" ? (
        <p className="mt-2 text-caption text-muted-foreground">{t("chat.voice_recordings_failed_hint")}</p>
      ) : null}
      {status === "complete" ? (
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

/** Recordings are loading: rows in their own shape. */
function RecordingListSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-2" aria-busy>
      <span className="sr-only">{label}</span>
      {["w-40", "w-32", "w-36"].map((w) => (
        <div key={w} className="flex items-start gap-3 rounded-lg border border-border px-3 py-3">
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", w)} />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
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
    () => [...recordings].sort((a, b) => (parseTs(b.started_at) ?? 0) - (parseTs(a.started_at) ?? 0)),
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
              <RecordingListSkeleton label={t("chat.voice_recordings_loading")} />
            ) : isError ? (
              <div role="alert" className="flex flex-col items-start gap-2 px-1">
                <p className="text-body text-destructive">{t("chat.voice_recordings_load_failed")}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
                  {t("chat.retry")}
                </Button>
              </div>
            ) : sorted.length === 0 ? (
              <Empty className="py-10">
                <EmptyHeader>
                  <EmptyMedia>
                    <IconTile icon={AudioLines} tone={moduleTone("chat")} size="lg" />
                  </EmptyMedia>
                  <EmptyTitle>{t("chat.voice_recordings_empty")}</EmptyTitle>
                  <EmptyDescription className="text-caption">
                    {t("chat.voice_recordings_empty_hint")}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
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
            )}
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
