"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CircleQuestionMark, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createShortcutChord, type ShortcutChord } from "@uniwork/core/shortcuts";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { ShortcutKeycaps } from "../../editor/shortcut-keycaps";
import { TOOLBAR_BUTTON_CLASS } from "./page-toolbar-button";

type Keys = { typed: string[] } | { chords: ShortcutChord[] } | { text: ReactNode };
interface HelpRow { id: string; what: string; keys: Keys }
interface HelpSection { id: string; title: string; rows: HelpRow[] }

const primary = (key: string, shift = false) => createShortcutChord(key, { primary: true, shift });

/**
 * Every row is a shortcut a test proves works in the page editor
 * (page-shortcuts.test.ts). Ctrl/Cmd+K is deliberately absent: it is the app search.
 */
export function helpSections(t: (key: string) => string): HelpSection[] {
  const k = (key: string) => t(`documents.page_ui.toolbar.help.${key}`);
  return [
    { id: "quick", title: k("quick"), rows: [
      { id: "slash", what: k("quick_slash"), keys: { typed: ["/"] } },
      { id: "mention", what: k("quick_mention"), keys: { typed: ["@"] } },
    ] },
    { id: "line", title: k("line"), rows: [
      { id: "headings", what: k("line_headings"), keys: { typed: ["#", "##", "###"] } },
      { id: "bullet", what: k("line_bullet"), keys: { typed: ["-"] } },
      { id: "ordered", what: k("line_ordered"), keys: { typed: ["1."] } },
      { id: "task", what: k("line_task"), keys: { typed: ["[ ]"] } },
      { id: "quote", what: k("line_quote"), keys: { typed: [">"] } },
      { id: "code", what: k("line_code"), keys: { typed: ["```"] } },
      { id: "divider", what: k("line_divider"), keys: { typed: ["---"] } },
    ] },
    { id: "keys", title: k("keys"), rows: [
      { id: "format", what: k("keys_format"), keys: { chords: [primary("B"), primary("I")] } },
      { id: "strike", what: k("keys_strike"), keys: { chords: [primary("S", true)] } },
      { id: "code", what: k("keys_code"), keys: { chords: [primary("E")] } },
      { id: "undo", what: k("keys_undo"), keys: { chords: [primary("Z"), primary("Z", true)] } },
    ] },
  ];
}

function RowKeys({ keys }: { keys: Keys }) {
  if ("typed" in keys) {
    return <span className="flex flex-wrap justify-end gap-1">{keys.typed.map((text) => <Kbd key={text}>{text}</Kbd>)}</span>;
  }
  if ("chords" in keys) {
    return (
      <span className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
        {keys.chords.map((chord, index) => (
          <span key={index} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden className="text-muted-foreground">/</span> : null}
            <ShortcutKeycaps shortcut={chord} />
          </span>
        ))}
      </span>
    );
  }
  return <span>{keys.text}</span>;
}

/** The toolbar's "?" button and the popover it opens; `open` is lifted so the first-use hint can open it too. */
export function PageHelpPopover({
  open, onOpenChange, tabIndex, onFocus,
}: { open: boolean; onOpenChange: (open: boolean) => void; tabIndex: number; onFocus: () => void }) {
  const { t } = useTranslation();
  const label = t("documents.page_ui.toolbar.help.title");
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The tip can open this while the toolbar is scrolled away from the "?" button (phones).
  useEffect(() => {
    if (open) triggerRef.current?.scrollIntoView?.({ inline: "center", block: "nearest" });
  }, [open]);
  return (
    <Popover modal={false} open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              ref={triggerRef}
              data-tool="help"
              aria-label={t("documents.page_ui.toolbar.help_button")}
              tabIndex={tabIndex}
              onFocus={onFocus}
              onMouseDown={(event) => event.preventDefault()}
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-control outline-none hover:bg-muted",
                "focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-muted", TOOLBAR_BUTTON_CLASS,
              )}
            >
              <CircleQuestionMark aria-hidden className="size-4" />
            </PopoverTrigger>
          }
        />
        <TooltipContent side="bottom" sideOffset={6}>{t("documents.page_ui.toolbar.help_button")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        aria-label={label}
        side="bottom"
        align="end"
        sideOffset={6}
        className="max-h-[min(40rem,var(--available-height,40rem))] w-[min(26rem,calc(100vw-2rem))] gap-3 overflow-y-auto p-3"
        initialFocus={false}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-sm font-semibold">{label}</h2>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("documents.page_ui.toolbar.help.close")} onClick={() => onOpenChange(false)}>
            <X aria-hidden />
          </Button>
        </div>
        {helpSections(t).map((section) => (
          <section key={section.id} aria-label={section.title} className="flex flex-col gap-1">
            <h3 className="text-overline uppercase text-muted-foreground">{section.title}</h3>
            {section.rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-1 text-body">
                <span className="min-w-0">{row.what}</span>
                <RowKeys keys={row.keys} />
              </div>
            ))}
          </section>
        ))}
        <p className="text-caption text-muted-foreground">{t("documents.page_ui.toolbar.help.note")}</p>
      </PopoverContent>
    </Popover>
  );
}
