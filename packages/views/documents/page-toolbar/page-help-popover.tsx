"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CircleQuestionMark, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getShortcutPlatform, type ShortcutChord, type ShortcutPlatform } from "@uniwork/core/shortcuts";
import { Button } from "@uniwork/ui/components/ui/button";
import { Kbd } from "@uniwork/ui/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { pageShortcutChords, type PageShortcutId } from "../../editor/extensions/page-shortcuts";
import { ShortcutKeycaps } from "../../editor/shortcut-keycaps";
import { TOOLBAR_BUTTON_CLASS } from "./page-toolbar-button";

type Keys = { typed: string[] } | { chords: ShortcutChord[] } | { text: ReactNode };
interface HelpRow { id: string; what: string; keys: Keys }
interface HelpSection { id: string; title: string; rows: HelpRow[] }

/**
 * A "keys" row names rows of the page shortcut table: every key of each one
 * (`all`), or the preferred key of each one (a family such as Bold / Italic).
 */
function chordsOf(ids: readonly PageShortcutId[], platform: ShortcutPlatform, all: boolean): ShortcutChord[] {
  return ids.flatMap((id) => {
    const chords = pageShortcutChords(id, platform);
    return all ? chords : chords.slice(0, 1);
  });
}

/**
 * Every key row is read from the page shortcut table (`PAGE_SHORTCUTS`), the
 * same table the editor's handlers and the toolbar tooltips use, so what is
 * listed per platform is what a test fired (page-shortcuts.test.ts).
 */
export function helpSections(t: (key: string) => string, platform: ShortcutPlatform = getShortcutPlatform()): HelpSection[] {
  const k = (key: string) => t(`documents.page_ui.toolbar.help.${key}`);
  const keys = (id: string, ids: PageShortcutId[], all = false): HelpRow => ({
    id, what: k(`keys_${id}`), keys: { chords: chordsOf(ids, platform, all) },
  });
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
      keys("save", ["save"]),
      keys("undo", ["undo"]),
      keys("redo", ["redo"], true),
      keys("format", ["bold", "italic", "underline"]),
      keys("strike", ["strike"], true),
      keys("code", ["code"]),
      keys("link", ["link"]),
      keys("clear", ["clearFormatting"]),
    ].filter((row) => "chords" in row.keys && row.keys.chords.length > 0) },
    { id: "blocks", title: k("blocks"), rows: [
      keys("bullet", ["bulletList"], true),
      keys("ordered", ["orderedList"]),
      keys("task", ["taskList"]),
      keys("quote", ["blockquote"]),
      keys("code_block", ["codeBlock"]),
      keys("paragraph", ["paragraph"]),
      keys("headings", ["heading1", "heading2", "heading3"]),
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
