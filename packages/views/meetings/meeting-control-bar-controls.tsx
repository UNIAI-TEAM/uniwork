"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, FaceSlightlySmilingPlus, Settings } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { DialogTrigger } from "@uniwork/ui/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@uniwork/ui/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingAdjustViewDialog } from "./meeting-adjust-view-dialog";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";
import { REACTIONS, reactionLabelKey } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";
import { MEETING_CHIP } from "./meeting-control";
export { IconControl, MenuControl, MEETING_CHIP } from "./meeting-control";

export function DeviceSettingsControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("meetings.devices");

  if (inMenu) {
    return (
      <MeetingDevicesDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <DialogTrigger
            render={
              <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
            }
          >
            <Settings aria-hidden />
            {label}
          </DialogTrigger>
        }
      />
    );
  }

  return (
    <MeetingDevicesDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="meetingChip"
                    aria-label={label}
                    className={MEETING_CHIP}
                  />
                }
              />
            }
          >
            <Settings aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      }
    />
  );
}

export function AdjustViewControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = t("meetings.adjustView");

  if (inMenu) {
    return (
      <MeetingAdjustViewDialog
        open={open}
        onOpenChange={setOpen}
        trigger={
          <DialogTrigger
            render={
              <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
            }
          >
            <LayoutGrid aria-hidden />
            {label}
          </DialogTrigger>
        }
      />
    );
  }

  return (
    <MeetingAdjustViewDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Tooltip>
          <TooltipTrigger
            render={
              <DialogTrigger
                render={
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="meetingChip"
                    aria-label={label}
                    className={MEETING_CHIP}
                  />
                }
              />
            }
          >
            <LayoutGrid aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
      }
    />
  );
}

export function ReactionsControl({ inMenu = false }: { inMenu?: boolean }) {
  const { t } = useTranslation();
  const { react } = useMeetingSignals();
  const [open, setOpen] = useState(false);
  const label = t("meetings.react");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {inMenu ? (
        <PopoverTrigger
          render={
            <Button type="button" variant="ghost" className="h-11 w-full justify-start gap-3" />
          }
        >
          <FaceSlightlySmilingPlus aria-hidden />
          {label}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="icon-lg"
              variant="meetingChip"
              aria-label={label}
              className={MEETING_CHIP}
            />
          }
        >
          <FaceSlightlySmilingPlus aria-hidden />
        </PopoverTrigger>
      )}
      {/* `dark`: the popup portals to <body>, away from the dark stage it belongs to. */}
      <PopoverContent side="top" className="dark flex w-auto gap-1 p-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={t(reactionLabelKey(r) ?? "meetings.react")}
            className="flex size-11 items-center justify-center rounded-full text-title hover:bg-muted"
            onClick={() => {
              react(r);
              setOpen(false);
            }}
          >
            {r}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
