"use client";
import { ArrowLeft, Sparkles } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import { AppLink } from "../../navigation";
import { kitButton } from "./ui/kit-buttons";

/** Content narrower than 600: the phone frame (PLAN D10). */
const PHONE_MAX = 600;

/** Whether the element is narrower than the phone frame, following its own width (sidebar, docked panels). */
export function useNarrow(el: HTMLElement | null, enabled: boolean): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!enabled || !el) return;
    const measure = () => setNarrow(el.clientWidth > 0 && el.clientWidth < PHONE_MAX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, enabled]);
  return enabled && narrow;
}

const PhoneBarContext = createContext<HTMLElement | null>(null);

export const PhoneBarProvider = PhoneBarContext.Provider;

/**
 * The one primary action of the page: in place on a wide page, in the phone's
 * sticky bottom bar (kit `.p-bottom`) on a narrow one, full height 44.
 */
export function PhonePrimary({ children }: { children: ReactNode }) {
  const bar = useContext(PhoneBarContext);
  return bar ? createPortal(children, bar) : <>{children}</>;
}

/** Whether the strip's primary goes to the bottom bar (its secondary actions then live in ⋯). */
export function usePhoneBar(): boolean {
  return useContext(PhoneBarContext) !== null;
}

/**
 * The phone's top bar (kit `.p-top`) in place of the breadcrumb row: back to
 * the list, the title once the page header has scrolled away, and ⋯.
 */
export function PhoneTop({ title, listHref, showTitle, menu }: { title: string; listHref: string; showTitle: boolean; menu: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-1 border-b border-border bg-background px-1">
      <AppLink
        href={listHref}
        aria-label={t("meetings.detail.phone.back")}
        className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "size-11")}
      >
        <ArrowLeft aria-hidden />
      </AppLink>
      <p aria-hidden={!showTitle} className={cn("min-w-0 flex-1 truncate text-center text-body font-semibold", !showTitle && "invisible")}>
        {title}
      </p>
      {menu}
    </div>
  );
}

/**
 * The phone's sticky bottom bar: Ask UNI (✦) where the viewer may ask about
 * the meeting, then the primary the strip hands over. Empty, it takes no room.
 */
export function PhoneBottomBar({
  barRef,
  meetingId,
  title,
  workspaceId,
  ask,
}: {
  barRef: (el: HTMLDivElement | null) => void;
  meetingId: string;
  title: string;
  workspaceId: string;
  ask: boolean;
}) {
  const { t } = useTranslation();
  // Gated like the rail's Ask (`ask_uni`), and opened in whichever Ask UNI panel the workspace runs.
  const { data: caps } = useAiCapabilities(workspaceId);
  const openWithFocus = useAiPanelStore((s) => s.openWithFocus);
  const open = caps?.ask_uni ? () => openWithFocus({ kind: "meeting", id: meetingId, label: title }) : undefined;
  return (
    <div className="flex min-h-16 shrink-0 items-center gap-3 bg-popover px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-floating has-[[data-phone-bar]:empty]:hidden">
      {ask && open ? (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className={cn(kitButton.outline, "size-11 flex-none")}
          aria-label={t("ai.ask_about_meeting")}
          onClick={open}
        >
          <Sparkles aria-hidden />
        </Button>
      ) : null}
      <div
        ref={barRef}
        data-phone-bar=""
        className="flex min-w-0 flex-1 items-center gap-3 *:h-11 *:min-w-0 *:flex-1 [&>fieldset]:h-auto"
      />
    </div>
  );
}
