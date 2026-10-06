"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { PageBlock } from "./page-blocks";

interface PageBlockListProps {
  items: PageBlock[];
  editor: Editor;
  command: (item: PageBlock) => void;
}
export interface PageBlockListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const PageBlockList = forwardRef<PageBlockListHandle, PageBlockListProps>(function PageBlockList(
  { items, editor, command }, ref,
) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setSelected(0), [items]);
  useEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-controls", id);
    dom.setAttribute("aria-expanded", "true");
    if (items[selected]) dom.setAttribute("aria-activedescendant", `${id}-${items[selected]?.id}`);
    else dom.removeAttribute("aria-activedescendant");
    buttons.current[selected]?.scrollIntoView({ block: "nearest" });
    return () => {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-expanded");
      dom.removeAttribute("aria-activedescendant");
    };
  }, [editor, id, items, selected]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (isImeComposing(event) || !items.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        setSelected((value) => (value + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));
  return (
    <div id={id} role="listbox" aria-label={t("documents.page_ui.insert_block")}
      className="w-80 max-w-[calc(100vw-1rem)] max-h-[min(360px,var(--suggestion-available-height,360px))] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md">
      {!items.length ? <div className="p-3 text-caption text-muted-foreground">{t("documents.page_ui.no_blocks")}</div> : null}
      {items.map((item, index) => (
        <Button key={item.id} id={`${id}-${item.id}`} ref={(element) => { buttons.current[index] = element; }}
          type="button" variant="ghost" role="option" aria-selected={index === selected} tabIndex={-1}
          className={cn("h-auto min-h-11 w-full justify-start gap-3 px-3 py-2 text-left", index === selected && "bg-accent")}
          onMouseDown={(event) => event.preventDefault()} onPointerMove={() => setSelected(index)} onClick={() => command(item)}>
          <item.icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body font-medium">{t(`documents.page_ui.blocks.${item.id}.label`)}</span>
            <span className="text-caption font-normal text-muted-foreground">{t(`documents.page_ui.blocks.${item.id}.description`)}</span>
          </span>
        </Button>
      ))}
    </div>
  );
});
