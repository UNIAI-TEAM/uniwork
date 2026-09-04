"use client";

import { Sparkles } from "lucide-react";
import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_MEETING_TILES,
  MAX_MEETING_TILES,
  MEETING_VIEW_LAYOUTS,
  MIN_MEETING_TILES,
  useMeetingRoomPreferencesStore,
  type MeetingViewLayout,
} from "@uniwork/core/meetings/room-preferences";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@uniwork/ui/components/ui/dialog";
import { Label } from "@uniwork/ui/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@uniwork/ui/components/ui/radio-group";
import { Slider } from "@uniwork/ui/components/ui/slider";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { cn } from "@uniwork/ui/lib/utils";

function LayoutPreview({ layout }: { layout: MeetingViewLayout }) {
  const tile = "rounded-[2px] bg-muted-foreground/25 ring-1 ring-border/60";
  switch (layout) {
    case "auto":
      return (
        <div className="grid size-10 grid-cols-2 grid-rows-2 gap-0.5" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={tile} />
          ))}
        </div>
      );
    case "tiled":
      return (
        <div className="grid size-10 grid-cols-3 grid-rows-3 gap-px" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={tile} />
          ))}
        </div>
      );
    case "spotlight":
      return <div className={cn(tile, "size-10")} aria-hidden />;
    case "sidebar":
      return (
        <div className="flex size-10 gap-0.5" aria-hidden>
          <div className={cn(tile, "min-w-0 flex-1")} />
          <div className="flex w-2.5 shrink-0 flex-col gap-px">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={cn(tile, "flex-1")} />
            ))}
          </div>
        </div>
      );
  }
}

function layoutLabelKey(layout: MeetingViewLayout): string {
  switch (layout) {
    case "auto":
      return "meetings.viewLayoutAuto";
    case "tiled":
      return "meetings.viewLayoutTiled";
    case "spotlight":
      return "meetings.viewLayoutSpotlight";
    case "sidebar":
      return "meetings.viewLayoutSidebar";
  }
}

export function MeetingAdjustViewDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactNode;
}) {
  const { t } = useTranslation();
  const viewLayout = useMeetingRoomPreferencesStore((s) => s.viewLayout);
  const maxTiles = useMeetingRoomPreferencesStore((s) => s.maxTiles);
  const hideTilesWithoutVideo = useMeetingRoomPreferencesStore((s) => s.hideTilesWithoutVideo);
  const setViewLayout = useMeetingRoomPreferencesStore((s) => s.setViewLayout);
  const setMaxTiles = useMeetingRoomPreferencesStore((s) => s.setMaxTiles);
  const setHideTilesWithoutVideo = useMeetingRoomPreferencesStore((s) => s.setHideTilesWithoutVideo);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="sm:max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>{t("meetings.adjustView")}</DialogTitle>
          <DialogDescription>{t("meetings.adjustViewHint")}</DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={viewLayout}
          onValueChange={(value) => value && setViewLayout(value as MeetingViewLayout)}
          className="gap-1"
        >
          {MEETING_VIEW_LAYOUTS.map((layout) => (
            <label
              key={layout}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2.5 transition-colors",
                "hover:bg-muted/50 has-[[data-checked]]:bg-surface-selected",
              )}
            >
              <RadioGroupItem value={layout} id={`view-layout-${layout}`} />
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body text-foreground">
                {t(layoutLabelKey(layout))}
                {layout === "auto" ? <Sparkles aria-hidden className="size-3.5 text-brand" /> : null}
              </span>
              <LayoutPreview layout={layout} />
            </label>
          ))}
        </RadioGroup>

        <div className="space-y-3 rounded-lg bg-muted/20 px-3 py-3 ring-1 ring-border/60">
          <div>
            <p className="text-body font-medium text-foreground">{t("meetings.viewTiles")}</p>
            <p className="text-caption text-muted-foreground">{t("meetings.viewTilesHint")}</p>
          </div>
          <div className="flex items-center gap-3">
            <LayoutPreview layout="tiled" />
            <Slider
              className="flex-1"
              min={MIN_MEETING_TILES}
              max={MAX_MEETING_TILES}
              step={1}
              value={[maxTiles]}
              onValueChange={(values) => {
                const next = Array.isArray(values) ? values[0] : values;
                setMaxTiles(next ?? DEFAULT_MEETING_TILES);
              }}
              aria-label={t("meetings.viewTiles")}
            />
            <span className="w-6 text-center text-caption tabular-nums text-muted-foreground">
              {maxTiles}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <Label htmlFor="hide-no-video" className="text-body text-foreground">
            {t("meetings.hideTilesWithoutVideo")}
          </Label>
          <Switch
            id="hide-no-video"
            checked={hideTilesWithoutVideo}
            onCheckedChange={setHideTilesWithoutVideo}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
