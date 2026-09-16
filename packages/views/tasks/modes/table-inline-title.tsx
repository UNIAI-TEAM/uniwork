"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Title cell with inline rename and optional hierarchy disclosure. When
 * `editingDisabled`, the pencil stays visible but inert and explains why.
 */
export function InlineTitle({
  identifier,
  title,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleChildren,
  hierarchyDisabled = false,
  editingDisabled = false,
  editingDisabledReason,
  onCommit,
  className,
}: {
  identifier?: string;
  title: string;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleChildren?: () => void;
  hierarchyDisabled?: boolean;
  editingDisabled?: boolean;
  editingDisabledReason?: string;
  onCommit?: (next: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [editing, title]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title || !onCommit) return;
    onCommit(next);
  };

  return (
    <div
      className={cn("flex min-w-0 items-center gap-1", className)}
      style={{ paddingLeft: depth * 16 }}
    >
      {hasChildren && !hierarchyDisabled ? (
        // A plain button rather than the Button primitive: its coarse-pointer
        // min-h-11 would grow the 40px row the virtualizer is sized for, and
        // its ghost variant paints `aria-expanded` as a pressed background,
        // which would mark every open parent as active. The 44px coarse target
        // is an invisible `after:` hit area instead, like the header's reorder
        // grip; the global :focus-visible outline stays the focus indicator.
        <button
          type="button"
          className={cn(
            "relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            "after:absolute after:top-1/2 after:left-1/2 after:size-6 after:-translate-x-1/2 after:-translate-y-1/2 pointer-coarse:after:size-11",
          )}
          aria-expanded={!collapsed}
          aria-label={
            collapsed
              ? t("tasks.table.expand_children")
              : t("tasks.table.collapse_children")
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggleChildren?.();
          }}
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </button>
      ) : (
        <span className="inline-block size-6 shrink-0" aria-hidden />
      )}
      {identifier ? (
        <span
          className="shrink-0 text-caption text-muted-foreground"
          translate="no"
        >
          {identifier}
        </span>
      ) : null}
      {editing && !editingDisabled ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setDraft(title);
              setEditing(false);
            }
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          className="h-7 min-w-0 flex-1"
        />
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-body text-foreground">
            {title}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("tasks.table.rename")}
            disabled={editingDisabled}
            title={
              editingDisabled
                ? (editingDisabledReason ?? t("capabilities.unknown"))
                : undefined
            }
            onClick={(event) => {
              event.stopPropagation();
              if (editingDisabled) return;
              setEditing(true);
            }}
          >
            <Pencil className="size-3" aria-hidden />
          </Button>
        </>
      )}
    </div>
  );
}
