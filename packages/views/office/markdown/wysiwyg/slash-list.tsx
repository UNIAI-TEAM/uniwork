"use client";

/**
 * MarkdownSlashList — the popup body of the Markdown slash menu (M3).
 *
 * It is the list half of the shared suggestion machinery: `slash.ts` mounts a
 * `Suggestion` plugin through `createSuggestionPopupRender` (the same renderer
 * the page-document menu and the mention picker use) and this component is what
 * that renderer portals. Keyboard policy is NOT re-decided here either - arrow
 * movement and the Enter/Tab accept both come from `picker-keys.ts`, the one
 * place the product answers "what moves the highlight" and "what accepts".
 *
 * The list owns only the highlighted index; the filter and the insert command
 * live in `slash-items.ts`, and nothing here writes the document.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useTranslation } from "react-i18next";
import { isImeComposing } from "@uniwork/core/utils";
import { cn } from "@uniwork/ui/lib/utils";
import { isPickerAcceptKey, pickerNavigationDirection } from "../../../editor/picker-keys";
import { markdownSlashLabelKey, type MarkdownSlashItem } from "./slash-items";

export interface MarkdownSlashListProps {
  items: MarkdownSlashItem[];
  editor: Editor;
  command: (item: MarkdownSlashItem) => void;
}

export interface MarkdownSlashListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MarkdownSlashList = forwardRef<MarkdownSlashListHandle, MarkdownSlashListProps>(
  function MarkdownSlashList({ items, editor, command }, ref) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState(0);
    const id = useId();
    const buttons = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => setSelected(0), [items]);

    // Keep the editor's combobox ARIA pointed at the highlighted row, exactly
    // as the page menu does: the popup is portaled outside the editor DOM, so
    // the association has to be written onto the editor element itself.
    useEffect(() => {
      const dom = editor.view.dom;
      dom.setAttribute("aria-controls", id);
      dom.setAttribute("aria-expanded", "true");
      const active = items[selected];
      if (active) dom.setAttribute("aria-activedescendant", `${id}-${active.id}`);
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
        if (isImeComposing(event) || items.length === 0) return false;
        const direction = pickerNavigationDirection(event);
        if (direction !== null) {
          const delta = direction === "next" ? 1 : items.length - 1;
          setSelected((value) => (value + delta) % items.length);
          return true;
        }
        if (isPickerAcceptKey(event)) {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    return (
      <div
        id={id}
        role="listbox"
        aria-label={t("office.markdown.slash.label")}
        data-testid="md-slash-list"
        className="w-72 max-w-[calc(100vw-1rem)] max-h-[min(320px,var(--suggestion-available-height,320px))] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
      >
        {items.length === 0 ? (
          <div className="p-3 text-caption text-muted-foreground">{t("office.markdown.slash.empty")}</div>
        ) : null}
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-${item.id}`}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="option"
            aria-selected={index === selected}
            tabIndex={-1}
            data-slash-item={item.id}
            className={cn(
              "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body transition-colors",
              index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => setSelected(index)}
            onClick={() => command(item)}
          >
            <item.icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{t(markdownSlashLabelKey(item.id))}</span>
          </button>
        ))}
      </div>
    );
  },
);
