"use client";

import { useState, type MouseEventHandler, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LayoutGrid, Settings2, SmilePlus } from "lucide-react";
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
import { MEETING_DARK_BAR_CHIP } from "./meeting-dark-bar";
import { MeetingDevicesDialog } from "./meeting-devices-dialog";
import { REACTIONS } from "./meeting-signals";
import { useMeetingSignals } from "./use-meeting-signals";

/** Filled destructive on the dark bar. */
export const SOLID_DESTRUCTIVE =
  "border-destructive !bg-destructive text-brand-foreground hover:!bg-destructive/90 focus-visible:border-destructive focus-visible:ring-destructive/30";

export function IconControl({
  label,
  pressed,
  tone,
  onClick,
  disabled,
  children,
}: {
  label: string;
  pressed?: boolean;
  tone?: "off" | "active" | "copilot";
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-lg"
            variant={
              tone === "off"
                ? "outline"
                : tone === "active"
                  ? "brand"
                  : tone === "copilot"
                    ? "brand"
                    : pressed
                      ? "secondary"
                      : "outline"
            }
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              MEETING_DARK_BAR_CHIP,
              tone === "off" && SOLID_DESTRUCTIVE,
              tone === "active" && "!border-brand !bg-brand !text-brand-foreground hover:!bg-brand/90",
              tone === "copilot" && "!border-brand !bg-brand !text-brand-foreground hover:!bg-brand/90",
              !tone && !pressed && "border-meeting-bar-border",
              pressed && !tone && "!bg-meeting-bar-chip-hover",
            )}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function MenuControl({
  caption,
  pressed,
  onClick,
  disabled,
  children,
}: {
  caption: string;
  pressed?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "ghost"}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="h-11 w-full justify-start gap-3"
    >
      {children}
      {caption}
    </Button>
  );
}

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
            <Settings2 aria-hidden />
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
                    variant="outline"
                    aria-label={label}
                    className={MEETING_DARK_BAR_CHIP}
                  />
                }
              />
            }
          >
            <Settings2 aria-hidden />
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
                    variant="outline"
                    aria-label={label}
                    className={MEETING_DARK_BAR_CHIP}
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
          <SmilePlus aria-hidden />
          {label}
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="icon-lg"
              variant="outline"
              aria-label={label}
              className={MEETING_DARK_BAR_CHIP}
            />
          }
        >
          <SmilePlus aria-hidden />
        </PopoverTrigger>
      )}
      <PopoverContent side="top" className="flex w-auto gap-1 p-1.5">
        {REACTIONS.map((r) => (
          <button
            key={r}
            type="button"
            aria-label={r}
            className="flex size-10 items-center justify-center rounded-full text-title hover:bg-muted"
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
