"use client";

import { MoreVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MeetingJoinRequest } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingPersonAvatar } from "./meeting-person";

function requestDisplayName(request: MeetingJoinRequest): string {
  return request.display_name_snapshot || request.requester_user_id || "?";
}

export function MeetingJoinRequestRow({
  request,
  onApprove,
  onReject,
  approving,
  rejecting,
  variant = "sidebar",
}: {
  request: MeetingJoinRequest;
  onApprove: () => void;
  onReject: () => void;
  approving?: boolean;
  rejecting?: boolean;
  variant?: "sidebar" | "overlay" | "compact";
}) {
  const { t } = useTranslation();
  const name = requestDisplayName(request);

  if (variant === "overlay") {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
        <MeetingPersonAvatar name={name} size="default" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-foreground">{name}</p>
          <p className="text-caption text-muted-foreground">{t("meetings.unconfirmedGuest")}</p>
        </div>
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="min-w-0 truncate text-body">{name}</span>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" disabled={approving} onClick={onApprove}>
            {t("meetings.approve")}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={rejecting} onClick={onReject}>
            {t("meetings.reject")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-muted/40">
      <MeetingPersonAvatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body text-foreground">{name}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("h-8 shrink-0 rounded-lg px-3")}
        disabled={approving}
        onClick={onApprove}
      >
        {t("meetings.approve")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              aria-label={t("meetings.joinRequestActions")}
            />
          }
        >
          <MoreVertical aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={rejecting} onClick={onReject}>
            {t("meetings.reject")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export { requestDisplayName };
