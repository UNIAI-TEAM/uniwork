"use client";

import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxOutlineItem } from "./headings-outline";

export interface DocxNavigationPaneProps {
  /** Nested heading outline (`docxOutlineFromDoc(editor.state.doc)`). */
  items: readonly DocxOutlineItem[];
  /** Highlighted item; the wiring may track the caret (optional). */
  activeId?: string | null;
  /** Click handler: navigate to `item.pos` (see scrollDocxHeadingIntoView). */
  onSelect?: (item: DocxOutlineItem) => void;
  /** Collapse affordance; omitted when the host hides the pane itself. */
  onClose?: () => void;
  className?: string;
}

/** The TipTap editor view (`editor.view`) as far as scrolling a heading needs. */
export interface DocxOutlineScrollView {
  nodeDOM(pos: number): Node | null;
}

/** Scroll the heading at `pos` into view — genoffice NavPane's click behavior. */
export function scrollDocxHeadingIntoView(view: DocxOutlineScrollView | null | undefined, pos: number): boolean {
  const dom = view?.nodeDOM(pos);
  if (!dom || typeof (dom as Partial<Element>).scrollIntoView !== "function") return false;
  (dom as Element).scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

interface FlatOutlineEntry {
  item: DocxOutlineItem;
  depth: number;
}

function flattenOutline(items: readonly DocxOutlineItem[], depth = 0, out: FlatOutlineEntry[] = []): FlatOutlineEntry[] {
  for (const item of items) {
    out.push({ item, depth });
    flattenOutline(item.children, depth + 1, out);
  }
  return out;
}

/** Word's navigation pane: the headings outline with click-to-jump. The pane
 *  is presentational — the wiring owns the editor, the scroll and the toggle. */
export function DocxNavigationPane({ items, activeId, onSelect, onClose, className }: DocxNavigationPaneProps) {
  const { t } = useTranslation();
  const entries = flattenOutline(items);

  return (
    <aside
      aria-label={t("office.docx.view.navigation.label")}
      data-testid="docx-navigation-pane"
      className={cn("flex min-h-0 flex-col border-e border-border bg-background", className)}
    >
      <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-2">
        <span className="truncate text-label font-medium">{t("office.docx.view.navigation.title")}</span>
        {onClose ? (
          <Button
            type="button"
            variant="toolbar"
            size="icon-xs"
            aria-label={t("office.docx.view.navigation.close")}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p
          className="px-3 py-3 text-caption text-muted-foreground"
          data-testid="docx-navigation-empty"
        >
          {t("office.docx.view.navigation.empty")}
        </p>
      ) : (
        <nav aria-label={t("office.docx.view.navigation.list")} className="min-h-0 flex-1 overflow-y-auto p-1">
          <ul className="flex flex-col gap-0.5">
            {entries.map(({ item, depth }) => {
              const active = activeId === item.id;
              return (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`docx-navigation-item-${item.id}`}
                    data-active={active ? "true" : undefined}
                    aria-current={active ? "true" : undefined}
                    className="h-auto min-h-7 w-full justify-start whitespace-normal py-1 text-start data-[active=true]:bg-muted data-[active=true]:text-foreground"
                    style={{ paddingInlineStart: `${8 + depth * 12}px` }}
                    onClick={() => onSelect?.(item)}
                  >
                    {item.text}
                  </Button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </aside>
  );
}
