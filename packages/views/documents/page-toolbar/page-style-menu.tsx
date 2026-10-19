"use client";

import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";
import { ShortcutKeycaps } from "../../editor/shortcut-keycaps";
import { focusOnKeyboardOpen, menuArrowKeys } from "./menu-keys";
import { TOOLBAR_BUTTON_CLASS } from "./page-toolbar-button";
import { activeTextStyle, TEXT_STYLES } from "./page-toolbar-model";

/** Text / Heading 1-3 picker; the trigger always names the block the caret is in. */
export function PageStyleMenu({ editor, tabIndex, onFocus }: { editor: Editor; tabIndex: number; onFocus: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const current = useEditorState({ editor, selector: ({ editor: e }) => activeTextStyle(e) });
  const label = (id: string) => t(`documents.page_ui.blocks.${id}.label`);
  return (
    <Popover modal={false} open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-tool="style"
        aria-haspopup="menu"
        aria-label={t("documents.page_ui.toolbar.style_aria", { style: label(current) })}
        tabIndex={tabIndex}
        onFocus={onFocus}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          "inline-flex h-8 min-w-28 items-center justify-between gap-1.5 rounded-control px-2.5 text-body font-medium",
          "outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50", TOOLBAR_BUTTON_CLASS, "pointer-coarse:w-auto",
        )}
      >
        {label(current)}
        <ChevronDown aria-hidden className="size-3.5 shrink-0" />
      </PopoverTrigger>
      <PopoverContent
        role="menu"
        aria-label={t("documents.page_ui.toolbar.style_menu")}
        side="bottom"
        align="start"
        sideOffset={6}
        className="w-64 gap-0.5 p-1"
        initialFocus={focusOnKeyboardOpen}
        finalFocus={focusOnKeyboardOpen}
        onKeyDown={menuArrowKeys}
      >
        {TEXT_STYLES.map((style) => (
          <button
            key={style.id}
            type="button"
            role="menuitemradio"
            aria-checked={current === style.id}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-hidden select-none hover:bg-muted focus-visible:bg-muted aria-checked:bg-muted pointer-coarse:min-h-11"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              style.run(editor);
              setOpen(false);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {current === style.id ? <Check aria-hidden className="size-4" /> : null}
            </span>
            <span className={cn("min-w-0 flex-1 truncate", style.previewClass)}>{label(style.id)}</span>
            <ShortcutKeycaps shortcut={style.shortcut} decorative />
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
