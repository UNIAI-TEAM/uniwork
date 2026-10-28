"use client";

import { Lock, MessageCircle, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import { useResolveDMRoom } from "@uniwork/core/chat";
import { useParticipants } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { useOptionalWorkspace } from "../../layout/workspace-context";
import { useNavigation } from "../../navigation";
import { toastApiError } from "../../toast-api-error";
import { meetingLocale } from "../meeting-datetime";
import { MeetingPersonAvatar } from "../meeting-person";
import { useMemberIndex } from "../use-member-index";
import { BackToMeetingButton, ExitActions, ExitBottom, ExitStory } from "./exit-left";
import { ExitHeading, ExitMark } from "./exit-shell";

/** "Nhắn cho chủ trì": the direct conversation with whoever removed the viewer, on the chat page. */
function MessageButton({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const { t } = useTranslation();
  const nav = useNavigation();
  const ws = useOptionalWorkspace();
  const resolve = useResolveDMRoom(workspaceId);
  if (!ws) return null;
  const chat = paths.workspace(ws.workspace.organization_slug, ws.workspace.slug);
  return (
    <Button
      type="button"
      size="lg"
      className="min-h-12 rounded-xl bg-foreground text-body-lg font-semibold text-background hover:bg-foreground/90"
      aria-disabled={resolve.isPending || undefined}
      onClick={() => {
        if (resolve.isPending) return;
        resolve.mutateAsync(userId).then(
          (room) => {
            if (room?.id) nav.push(chat.chatConversation(room.id));
          },
          (err: unknown) => toastApiError(err, t("common.error")),
        );
      }}
    >
      <MessageCircle aria-hidden className="size-4" />
      {t("meetings.exit.removed.message")}
    </Button>
  );
}

/**
 * Board F: removed from the room. A member reads who did it and when off their
 * own participant row; a guest can no longer read the roster, so their screen
 * keeps the time they were cut off and the lock.
 */
export function ExitRemoved({
  meetingId,
  meetingTitle,
  workspaceId,
  guestMode,
  selfParticipantId,
  at,
  onBackToMeeting,
}: {
  meetingId: string;
  meetingTitle?: string;
  workspaceId?: string;
  guestMode?: boolean;
  selfParticipantId: string | null;
  at: string;
  onBackToMeeting: () => void;
}) {
  const { t, i18n } = useTranslation();
  const phone = useIsMobile();
  const member = !guestMode && Boolean(workspaceId);
  const { data: participants } = useParticipants(member ? meetingId : "");
  const { memberOf } = useMemberIndex(member ? (workspaceId ?? "") : "");
  const mine = participants?.find((p) => p.id === selfParticipantId);
  const removerId = member ? mine?.removed_by : undefined;
  const removerName = removerId ? (memberOf(removerId)?.display_name ?? "") : "";
  const time = new Date(mine?.removed_at ?? at).toLocaleTimeString(meetingLocale(i18n.language), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const title = meetingTitle ?? "";
  const line = removerName
    ? t("meetings.exit.removed.line", { name: removerName, time, title })
    : t("meetings.exit.removed.lineNoName", { time, title });

  const story = (
    <>
      <ExitMark className="bg-destructive-soft text-destructive-soft-foreground ring-destructive/10">
        <UserX aria-hidden />
      </ExitMark>
      <ExitHeading title={t("meetings.exit.removed.title")}>
        <div className="flex flex-col items-center gap-3">
          <span className="inline-flex items-center gap-2 text-body text-muted-foreground">
            {removerName ? <MeetingPersonAvatar name={removerName} size={22} /> : null}
            {line}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive-soft px-2.5 py-1 text-caption font-medium text-destructive-soft-foreground">
            <Lock aria-hidden className="size-3" />
            {t("meetings.exit.removed.locked")}
          </span>
        </div>
      </ExitHeading>
    </>
  );
  const actions = (
    <ExitActions
      primary={removerId && workspaceId ? <MessageButton workspaceId={workspaceId} userId={removerId} /> : null}
      secondary={
        <BackToMeetingButton onClick={onBackToMeeting} label={guestMode ? t("common.back") : undefined} />
      }
    />
  );
  if (phone) {
    return (
      <>
        <ExitStory>{story}</ExitStory>
        <ExitBottom>{actions}</ExitBottom>
      </>
    );
  }
  return (
    <>
      {story}
      {actions}
    </>
  );
}
