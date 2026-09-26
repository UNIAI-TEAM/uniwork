"use client";

import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { MeetingDetailView } from "../meetings/meeting-detail-view";

export function CalendarMeetingPanel({
  workspaceId,
  meetingId,
  onClose,
  onJoin,
  onOpenFullPage,
}: {
  workspaceId: string;
  meetingId: string;
  onClose: () => void;
  onJoin: (meetingId: string) => void;
  onOpenFullPage: (meetingId: string) => void;
}) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, [meetingId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !panelRef.current?.contains(document.activeElement)
      ) {
        return;
      }
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <aside
      ref={panelRef}
      aria-label={t("calendar.meeting_panel_label")}
      className="absolute inset-y-0 right-0 z-40 flex min-h-0 w-[min(40rem,calc(100%-1rem))] shrink-0 flex-col overflow-hidden border-l border-border bg-background shadow-[var(--floating-shadow)] 2xl:relative 2xl:z-auto 2xl:w-[40rem] 2xl:shadow-none"
    >
      <MeetingDetailView
        workspaceId={workspaceId}
        meetingId={meetingId}
        layout="panel"
        onJoin={() => onJoin(meetingId)}
        onDeleted={onClose}
        headerActions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("calendar.open_meeting_full_page")}
                    onClick={() => onOpenFullPage(meetingId)}
                  />
                }
              >
                <ExternalLink aria-hidden className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("calendar.open_meeting_full_page")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={closeButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("common.close")}
                    onClick={onClose}
                  />
                }
              >
                <X aria-hidden className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("common.close")}</TooltipContent>
            </Tooltip>
          </>
        }
      />
    </aside>
  );
}
