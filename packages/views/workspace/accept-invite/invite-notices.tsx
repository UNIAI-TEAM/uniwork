"use client";
import { Hourglass, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Alert, AlertDescription } from "@uniwork/ui/components/ui/alert";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Why an invitation cannot be used, and what to do about it: a glyph for the
 * reason on a quiet band, shared by the error and the "no longer valid"
 * screens. The hairline glyph is the auth surfaces' raised-card stroke.
 */
export function InviteNotice({ icon, tone, children }: { icon: LucideIcon; tone: IconTileTone; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-4">
      <IconTile
        icon={icon}
        tone={tone}
        size="md"
        className={cn("[&_svg]:stroke-[1.5]", tone === "muted" && "bg-background ring-1 ring-border/60")}
      />
      <p className="min-w-0 self-center text-pretty text-body text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The account was busy with another change and nothing happened: a passing
 * state, so a polite status in the warning tone, placed right above the
 * button that tries again.
 */
export function BusyNotice() {
  const { t } = useTranslation();
  return (
    <Alert variant="warning" role="status">
      <Hourglass aria-hidden />
      <AlertDescription>{t("invitations.switch.busy")}</AlertDescription>
    </Alert>
  );
}

/** The situation changed under the person (a conflict, nothing failed): look again. */
export function ChangedNotice() {
  const { t } = useTranslation();
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertDescription>{t("invitations.switch.changed")}</AlertDescription>
    </Alert>
  );
}
