"use client";

import { useState } from "react";
import { FaceNeutral, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CallRating } from "@uniwork/core/api/endpoints/meetings";
import { useRateCall } from "@uniwork/core/meetings";
import { Button } from "@uniwork/ui/components/ui/button";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";

// Stable, so it focuses once on mount and not on every re-render.
const focusOnMount = (el: HTMLElement | null) => el?.focus();

const RATINGS: { value: CallRating; icon: LucideIcon }[] = [
  { value: "good", icon: ThumbsUp },
  { value: "ok", icon: FaceNeutral },
  { value: "poor", icon: ThumbsDown },
];

/**
 * "Âm thanh, hình ảnh thế nào?" with Tốt / Tạm / Kém, once: the answer is only
 * counted (spec decision 2), so a failed send is not worth a retry or a toast.
 * A phone keeps the three as 44px icons.
 */
export function ExitRating({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const phone = useIsMobile();
  const rate = useRateCall(meetingId);
  const [rated, setRated] = useState(false);
  if (rated) {
    return (
      <p role="status" tabIndex={-1} ref={focusOnMount} className="text-label text-muted-foreground">
        {t("meetings.exit.rate.thanks")}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2.5">
      {phone ? null : <span className="text-label text-muted-foreground">{t("meetings.exit.rate.question")}</span>}
      {RATINGS.map(({ value, icon: Icon }) => (
        <Button
          key={value}
          type="button"
          variant="outline"
          size={phone ? "icon-lg" : "sm"}
          className="rounded-full"
          aria-label={phone ? t(`meetings.exit.rate.${value}Label`) : undefined}
          onClick={() => {
            setRated(true);
            rate.mutate(value);
          }}
        >
          <Icon aria-hidden className="size-4" />
          {phone ? null : t(`meetings.exit.rate.${value}`)}
        </Button>
      ))}
    </div>
  );
}
