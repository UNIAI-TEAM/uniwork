"use client";
import { Hourglass, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Why an invitation cannot be used, and what to do about it: a glyph for the
 * reason on the muted Alert band, shared by the error and the "no longer
 * valid" screens. A note, not an alert: the screen's heading takes focus and
 * announces the screen; this is the hint that comes with it. The hairline
 * glyph is the auth surfaces' raised-card stroke; the tile, not an inline
 * svg, so the band is laid out as a row rather than the Alert's icon grid.
 */
export function InviteNotice({ icon, tone, children }: { icon: LucideIcon; tone: IconTileTone; children: ReactNode }) {
  return (
    <Alert variant="muted" role="note" className="flex items-start gap-3 rounded-xl border-0 p-4">
      <IconTile
        icon={icon}
        tone={tone}
        size="md"
        className={cn("[&_svg]:stroke-[1.5]", tone === "muted" && "bg-background ring-1 ring-border/60")}
      />
      <AlertDescription className="min-w-0 self-center text-pretty">{children}</AlertDescription>
    </Alert>
  );
}

/** Why the last attempt changed nothing and can simply be sent again. */
export type RetryReason = "busy" | "failed";

/**
 * The account was busy with another change, or the request never got an
 * answer, and nothing happened: a passing state, so a polite status in the
 * warning tone, placed right above the button that tries again.
 */
export function RetryNotice({ why }: { why: RetryReason }) {
  const { t } = useTranslation();
  return (
    <Alert variant="warning" role="status">
      <Hourglass aria-hidden />
      <AlertDescription>{why === "busy" ? t("invitations.switch.busy") : t("invitations.switch.send_failed")}</AlertDescription>
    </Alert>
  );
}

/**
 * The situation changed under the person (a conflict, nothing failed): look
 * again. A status, not an alert: it appears as the step heading takes focus,
 * and an alert would cut that announcement off.
 */
export function ChangedNotice() {
  const { t } = useTranslation();
  return (
    <Alert variant="warning" role="status">
      <TriangleAlert aria-hidden />
      <AlertDescription>{t("invitations.switch.changed")}</AlertDescription>
    </Alert>
  );
}
