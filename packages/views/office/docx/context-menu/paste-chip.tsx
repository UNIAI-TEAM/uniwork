"use client";

import { ClipboardPaste } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";
import type { DocxPasteMode } from "./paste-options";

const PASTE_MODES: ReadonlyArray<{ mode: DocxPasteMode; labelKey: string }> = [
  { mode: "source", labelKey: "office.docx.paste.keepFormatting" },
  { mode: "merge", labelKey: "office.docx.paste.matchDestination" },
  { mode: "text", labelKey: "office.docx.paste.plainText" },
];

export interface DocxPasteChipProps {
  mode: DocxPasteMode;
  onApply: (mode: DocxPasteMode) => void;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The post-paste chip (Word parity, rebuilt on the UniWork primitives): the
 * three paste modes as radio-flavoured buttons, the current one marked. The
 * chip is presentational — the surface owns the controller and the position.
 */
export function DocxPasteChip({ mode, onApply, onDismiss, className, style }: DocxPasteChipProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current && !rootRef.current.contains(target)) onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [onDismiss]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={t("office.docx.paste.label")}
      data-testid="docx-paste-chip"
      style={style}
      className={cn(
        "flex items-center gap-0.5 rounded-control border border-border bg-surface-raised p-0.5 shadow-[var(--menu-shadow)]",
        className,
      )}
    >
      <ClipboardPaste aria-hidden className="mx-1 size-4 text-muted-foreground" />
      {PASTE_MODES.map((entry) => (
        <Button
          key={entry.mode}
          type="button"
          size="xs"
          variant={entry.mode === mode ? "brandSubtle" : "toolbar"}
          aria-pressed={entry.mode === mode}
          data-testid={`docx-paste-${entry.mode}`}
          onClick={() => onApply(entry.mode)}
        >
          {t(entry.labelKey)}
        </Button>
      ))}
    </div>
  );
}
