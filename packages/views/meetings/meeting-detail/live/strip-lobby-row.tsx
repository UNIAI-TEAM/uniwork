"use client";
import { DoorOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useJoinRequests } from "@uniwork/core/meetings";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "../../meeting-person";
import { useJoinRequestActions } from "../../use-join-request-actions";
import { meetingAvatarTint } from "../avatar-tint";
import { useDetail } from "../detail-context";
import { kitButton } from "../ui/kit-buttons";

/**
 * The people waiting at the door (kit `.lobby`), one row each, for the host or
 * a workspace admin only: the join-request list answers 403 to anyone else, so
 * the caller mounts this only when `canHost`. Past the scheduled end the room
 * takes nobody in, so [Cho vào] gives way to "Gia hạn để cho vào".
 */
export function StripLobbyRows() {
  const { meeting } = useDetail();
  const { data } = useJoinRequests(meeting.id);
  const actions = useJoinRequestActions(meeting.id);
  const pending = (data ?? []).filter((r) => r.status === "PENDING");
  return (
    <>
      {pending.map((request) => (
        <LobbyRow key={request.id} request={request} actions={actions} />
      ))}
    </>
  );
}

function LobbyRow({
  request,
  actions,
}: {
  request: MeetingJoinRequest;
  actions: ReturnType<typeof useJoinRequestActions>;
}) {
  const { t } = useTranslation();
  const { displayStatus, memberIndex } = useDetail();
  const name = request.display_name_snapshot?.trim() || t("meetings.guest");
  const guest = !request.requester_user_id;
  const overtime = displayStatus === "OVERTIME";
  const busy = actions.isApproving(request.id) || actions.isRejecting(request.id);
  const phoneButton = "@max-[37.5rem]/meeting:h-11";
  return (
    <div className="flex min-h-14 items-center gap-3 py-2 @max-[37.5rem]/meeting:flex-wrap @max-[37.5rem]/meeting:gap-y-0 @max-[37.5rem]/meeting:pb-3">
      <DoorOpen aria-hidden className="size-4 flex-none text-muted-foreground" />
      <MeetingPersonAvatar
        name={name}
        size={28}
        tint={guest ? "gray" : meetingAvatarTint(request.requester_user_id, memberIndex.members)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">{t("meetings.detail.live.lobbyAsks", { name })}</p>
        <p className="text-caption text-muted-foreground">
          {guest ? t("meetings.detail.live.lobbyGuest") : t("meetings.detail.live.lobbyMember")}
        </p>
      </div>
      <div
        className={cn(
          "ml-auto flex flex-none items-center",
          overtime ? "gap-4" : "gap-2",
          // Phone: the actions take a line of their own, split in two.
          overtime
            ? "@max-[37.5rem]/meeting:ml-0 @max-[37.5rem]/meeting:w-full @max-[37.5rem]/meeting:gap-3"
            : "@max-[37.5rem]/meeting:mt-2 @max-[37.5rem]/meeting:ml-0 @max-[37.5rem]/meeting:grid @max-[37.5rem]/meeting:w-full @max-[37.5rem]/meeting:grid-cols-2",
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className={cn(kitButton.base, kitButton.ghostDanger, phoneButton)}
          aria-label={t("meetings.detail.live.lobbyRejectName", { name })}
          disabled={busy}
          onClick={() => actions.rejectOne(request.id)}
        >
          {t("meetings.reject")}
        </Button>
        {overtime ? (
          <span className="text-caption text-muted-foreground">{t("meetings.detail.live.lobbyExtendFirst")}</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={cn(kitButton.base, kitButton.outline, phoneButton)}
            aria-label={t("meetings.detail.live.lobbyAdmitName", { name })}
            disabled={busy}
            onClick={() => actions.approveOne(request.id)}
          >
            {t("meetings.approve")}
          </Button>
        )}
      </div>
    </div>
  );
}
