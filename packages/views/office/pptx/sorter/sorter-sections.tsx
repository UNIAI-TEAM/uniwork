"use client";

/**
 * A2 UI half (UNI-927) - the section list of the slide sorter.
 *
 * Pure view over the deck's sections: it renders the positional groups the engine
 * half normalizes (`groupSlidesIntoSections`, A2e) and reports the five section
 * gestures back to the panel. Renaming is inline (a text field inside the row) so
 * the list needs no dialog and stays reachable by keyboard; every action is
 * disabled with a reason when the deck is read-only, empty or mid-edit.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { cn } from "@uniwork/ui/lib/utils";
import type { PptxSectionGroup, PptxSectionInfo } from "@uniwork/office-engine/pptx";
import { canMoveSection, groupRangeLabel, normalizeSectionName, sorterSectionGroups } from "./sorter-helpers";

export interface PptxSorterSectionsProps {
  sections: readonly PptxSectionInfo[];
  slideCount: number;
  /** Index of the slide the "Add section" action starts from. */
  selectedIndex: number;
  /** Section id currently being renamed, or null. */
  renamingId: string | null;
  /** Section id whose edit is still applying; its actions stay disabled. */
  busyId?: string | null;
  disabled: boolean;
  /** Why every action is disabled; rendered as each control's tooltip. */
  disabledReason?: string;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onAdd: (atSlideIndex: number) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onSelectSlide: (index: number) => void;
}

function groupCovers(group: PptxSectionGroup, index: number): boolean {
  return index >= group.start && index < group.end;
}

export function PptxSorterSections({
  sections,
  slideCount,
  selectedIndex,
  renamingId,
  busyId = null,
  disabled,
  disabledReason,
  onStartRename,
  onCancelRename,
  onRename,
  onAdd,
  onRemove,
  onMove,
  onSelectSlide,
}: PptxSorterSectionsProps) {
  const { t } = useTranslation();
  const groups = sorterSectionGroups(sections, slideCount);
  const named = groups.filter((group) => group.id !== null);
  return (
    <section
      aria-label={t("office.pptx.sections.label")}
      className="flex min-h-0 flex-col gap-1.5 rounded-md border border-border bg-muted/10 p-2"
      data-pptx-sorter-sections
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-label font-medium">{t("office.pptx.sections.title")}</h3>
        <span className="text-caption text-muted-foreground" data-pptx-sorter-section-count data-testid="pptx-sorter-section-count">
          {t("office.pptx.sections.count", { value: named.length })}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          aria-label={t("office.pptx.sections.add_at", { index: selectedIndex + 1 })}
          data-pptx-sorter-add-section
          onClick={() => onAdd(selectedIndex)}
        >
          <Plus aria-hidden className="size-3.5" />
          {t("office.pptx.sections.add")}
        </Button>
      </header>
      {named.length === 0 ? (
        <p className="px-1 text-caption text-muted-foreground" data-pptx-sorter-sections-none data-testid="pptx-sorter-sections-none">
          {t("office.pptx.sections.none")}
        </p>
      ) : null}
      <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {groups.map((group) => (
          <SectionRow
            key={group.id ?? "unsectioned"}
            group={group}
            sections={sections}
            selectedIndex={selectedIndex}
            renaming={group.id !== null && renamingId === group.id}
            busy={group.id !== null && busyId === group.id}
            disabled={disabled}
            disabledReason={disabledReason}
            onStartRename={onStartRename}
            onCancelRename={onCancelRename}
            onRename={onRename}
            onRemove={onRemove}
            onMove={onMove}
            onSelectSlide={onSelectSlide}
          />
        ))}
      </ul>
    </section>
  );
}

interface SectionRowProps {
  group: PptxSectionGroup;
  sections: readonly PptxSectionInfo[];
  selectedIndex: number;
  renaming: boolean;
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: "up" | "down") => void;
  onSelectSlide: (index: number) => void;
}

function SectionRow({
  group,
  sections,
  selectedIndex,
  renaming,
  busy,
  disabled,
  disabledReason,
  onStartRename,
  onCancelRename,
  onRename,
  onRemove,
  onMove,
  onSelectSlide,
}: SectionRowProps) {
  const { t } = useTranslation();
  const id = group.id;
  const range = groupRangeLabel(group);
  const unsectioned = id === null;
  const name = unsectioned ? t("office.pptx.sections.unsectioned") : group.name;
  const [draft, setDraft] = useState(group.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming) return;
    setDraft(group.name);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [group.name, renaming]);
  const commit = () => {
    const normalized = normalizeSectionName(draft);
    if (!normalized || unsectioned) return;
    onRename(id, normalized);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelRename();
    }
  };
  return (
    <li
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-sm border border-border bg-background px-2 py-1.5",
        !unsectioned && groupCovers(group, selectedIndex) && "border-primary/60",
      )}
      data-pptx-sorter-section={id ?? "unsectioned"}
      data-pptx-sorter-section-busy={busy ? "true" : undefined}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {renaming && !unsectioned ? (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <Input
              ref={inputRef}
              value={draft}
              aria-label={t("office.pptx.sections.rename_label")}
              className="h-7 min-w-0 flex-1"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={normalizeSectionName(draft) === null}
              aria-label={t("office.pptx.sections.rename_save")}
              onClick={commit}
            >
              {t("office.pptx.sections.rename_save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" aria-label={t("office.pptx.sections.rename_cancel")} onClick={onCancelRename}>
              {t("office.pptx.sections.rename_cancel")}
            </Button>
            {normalizeSectionName(draft) === null ? (
              <span className="shrink-0 text-caption text-destructive" data-pptx-sorter-rename-empty>
                {t("office.pptx.sections.rename_empty")}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate text-body" data-pptx-sorter-section-name>
            {name}
          </span>
        )}
        {range ? (
          <span className="shrink-0 text-caption text-muted-foreground">
            {t("office.pptx.sections.range", { start: range.start, end: range.end })}
          </span>
        ) : null}
        {!unsectioned ? (
          <span className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || busy || !canMoveSection(sections, id, "up")}
              title={disabled ? disabledReason : undefined}
              aria-label={t("office.pptx.sections.move_up", { name })}
              data-pptx-sorter-section-up={id}
              onClick={() => onMove(id, "up")}
            >
              <ChevronUp aria-hidden className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || busy || !canMoveSection(sections, id, "down")}
              title={disabled ? disabledReason : undefined}
              aria-label={t("office.pptx.sections.move_down", { name })}
              data-pptx-sorter-section-down={id}
              onClick={() => onMove(id, "down")}
            >
              <ChevronDown aria-hidden className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || busy}
              title={disabled ? disabledReason : undefined}
              aria-label={t("office.pptx.sections.rename", { name })}
              data-pptx-sorter-section-rename={id}
              onClick={() => onStartRename(id)}
            >
              <Pencil aria-hidden className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled || busy}
              title={disabled ? disabledReason : undefined}
              aria-label={t("office.pptx.sections.remove", { name })}
              data-pptx-sorter-section-remove={id}
              onClick={() => onRemove(id)}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </span>
        ) : null}
      </div>
      <ol className="flex min-w-0 flex-wrap gap-1">
        {Array.from({ length: Math.max(0, group.end - group.start) }, (_, offset) => group.start + offset).map((index) => (
          <li key={index}>
            <Button
              type="button"
              size="xs"
              variant={index === selectedIndex ? "secondary" : "ghost"}
              aria-label={t("office.pptx.sections.select_group", { index: index + 1, name })}
              data-pptx-sorter-section-slide={index}
              onClick={() => onSelectSlide(index)}
            >
              {index + 1}
            </Button>
          </li>
        ))}
      </ol>
    </li>
  );
}