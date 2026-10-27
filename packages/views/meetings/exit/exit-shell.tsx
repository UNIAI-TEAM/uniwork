"use client";

import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { useIsMobile } from "@uniwork/ui/hooks/use-mobile";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";

/**
 * The leave screens' frame (canvas boards A–F): the room's dark ground, the
 * UniWork lockup with "← Cuộc họp" on the left and the meeting's date on the
 * right; on a phone the back link keeps the thumb's corner and the mark moves
 * right. The column in the middle holds one screen's story.
 */
export function ExitShell({
  meetingsHref,
  dateLine,
  children,
  footer,
}: {
  meetingsHref?: string;
  dateLine?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const phone = useIsMobile();
  const back = meetingsHref ? (
    <AppLink
      href={meetingsHref}
      className="inline-flex min-h-11 items-center gap-2 text-body text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {t("meetings.title")}
    </AppLink>
  ) : null;
  return (
    <div className="dark flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground" data-testid="meeting-exit">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7 sm:py-5">
        {phone ? (
          <>
            {back ?? <span />}
            <Logo variant="mark" size={18} />
          </>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <Logo variant="lockup" size={20} />
              {back ? <span aria-hidden className="h-5 w-px bg-border" /> : null}
              {back}
            </div>
            {dateLine ? <span className="text-label text-muted-foreground">{dateLine}</span> : null}
          </>
        )}
      </header>
      {/* A phone pins the actions to the bottom (PhoneLeft/PhoneEnded boards): the column fills the height. */}
      <main className={cn("flex flex-1 flex-col items-center px-4", phone ? "pb-6" : "justify-center pb-14")}>
        <div className={cn("flex w-full max-w-[35rem] flex-col items-center text-center", phone ? "flex-1 gap-6" : "gap-7")}>
          {children}
        </div>
      </main>
      {footer}
    </div>
  );
}

/** The round mark at the top of a leave screen: 72px, the state's icon at 24px. */
export function ExitMark({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-18 shrink-0 items-center justify-center rounded-full bg-surface-hover text-foreground ring-8 ring-foreground/5 [&_svg]:size-6",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Title and the line under it; the heading takes focus when the screen appears. */
export function ExitHeading({ title, children }: { title: string; children?: ReactNode }) {
  const phone = useIsMobile();
  return (
    <div className="flex flex-col items-center gap-2">
      <h1
        data-gate-heading
        tabIndex={-1}
        className={cn("font-display font-bold text-foreground outline-none", phone ? "text-display-sm" : "text-display")}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}
