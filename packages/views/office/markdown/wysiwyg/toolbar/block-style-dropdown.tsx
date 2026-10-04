"use client";

/**
 * The block-style control: ONE compact dropdown holding paragraph, H1-H6,
 * quote and code (brief C8's "one compact dropdown", C7's fixed order).
 *
 * It shows the style at the cursor, so a writer sees "Heading 2" rather than a
 * glyph they have to decode, and it reports the level the document really has
 * (a Markdown file can carry H4-H6) instead of falling through to paragraph.
 */
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import { MARKDOWN_BLOCK_STYLES, headingLevelOf } from "./groups";
import type { MarkdownBlockStyle } from "./types";

/** i18next key for one block style. */
function blockStyleLabelKey(style: MarkdownBlockStyle): string {
  if (style === "paragraph") return "office.markdown.wysiwyg.paragraph";
  if (style === "quote") return "office.markdown.wysiwyg.quote";
  if (style === "code") return "office.markdown.wysiwyg.codeBlock";
  return "office.markdown.wysiwyg.heading";
}

/** Options for the i18next call: a heading needs its level. */
function blockStyleLabelOptions(style: MarkdownBlockStyle): Record<string, number> | undefined {
  const level = headingLevelOf(style);
  return level === null ? undefined : { level };
}

export interface BlockStyleDropdownProps {
  value: MarkdownBlockStyle;
  /**
   * Read-only: the trigger itself is disabled, so no pointer path (Base UI
   * opens a menu on mousedown) and no keyboard path (Enter/Arrow) can open it.
   * `aria-disabled` stays on the button so the control keeps its reason in the
   * tab order; `disabled` is what Base UI actually gates hover/click/key on.
   */
  disabled?: boolean;
  onChange: (style: MarkdownBlockStyle) => void;
}

export function BlockStyleDropdown({ value, disabled = false, onChange }: BlockStyleDropdownProps) {
  const { t } = useTranslation();
  const label = t(blockStyleLabelKey(value), blockStyleLabelOptions(value));
  const menuLabel = t("office.markdown.wysiwyg.blockStyle");
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              disabled={disabled}
              render={
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={menuLabel}
                  aria-disabled={disabled || undefined}
                  data-toolbar-control="blockStyle"
                  className="h-[22px] min-w-28 justify-between gap-1.5 px-1.5 text-caption font-normal pointer-coarse:min-h-11"
                />
              }
            />
          }
        >
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden className="size-3" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-44" data-toolbar-menu="blockStyle">
        {MARKDOWN_BLOCK_STYLES.map((style) => (
          <DropdownMenuItem
            key={style}
            onClick={() => onChange(style)}
            data-toolbar-style={style}
            className={cn("gap-2", style === value && "bg-surface-selected text-surface-selected-foreground")}
          >
            <span className="flex-1">{t(blockStyleLabelKey(style), blockStyleLabelOptions(style))}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
