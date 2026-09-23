"use client";

import { Archive, Building2, CornerDownRight, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Department } from "@uniwork/core/types/people";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { SettingsListItem } from "./settings-layout";

/**
 * One department. Renaming is an explicit mode — "Đổi tên" turns the name
 * into a field; Enter or leaving the field saves, Esc puts the old name back
 * — so a stray click can never rename anything. The row stays in edit mode
 * when the save fails, with the draft intact.
 */
export function DepartmentRow({
  department,
  childCount,
  canManage,
  onRename,
  onArchive,
}: {
  department: Department;
  childCount: number;
  canManage: boolean;
  onRename: (department: Department, name: string) => Promise<boolean>;
  onArchive: (department: Department) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(department.name);
  const [saving, setSaving] = useState(false);
  // Refs, not state: Enter and the blur that may follow it land in the same
  // tick, before a state update would be visible to the second handler.
  const savingRef = useRef(false);
  const skipBlurRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isChild = Boolean(department.parent_id);
  const hintId = `department-${department.id}-hint`;

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    skipBlurRef.current = false;
    setDraft(department.name);
    setEditing(true);
  };

  const cancel = () => {
    skipBlurRef.current = true;
    setDraft(department.name);
    setEditing(false);
  };

  const commit = async () => {
    if (savingRef.current) return;
    const next = draft.trim();
    if (!next || next === department.name) {
      setEditing(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    const ok = await onRename(department, next);
    savingRef.current = false;
    setSaving(false);
    if (ok) setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  const onBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    void commit();
  };

  const meta = editing
    ? t("departments.rename_hint")
    : [
        department.code,
        t("departments.member_count", { count: department.member_count }),
        canManage && childCount > 0 ? t("departments.has_children", { count: childCount }) : "",
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <SettingsListItem
      className={isChild ? "pl-10" : undefined}
      leading={
        isChild ? (
          <span className="flex size-7 items-center justify-center text-muted-foreground">
            <CornerDownRight aria-hidden className="size-4" />
          </span>
        ) : (
          <IconTile icon={Building2} size="sm" />
        )
      }
      title={
        editing ? (
          // Padding so the focus outline is not clipped by the truncating title.
          <span className="block p-1">
            <Input
              ref={inputRef}
              aria-label={t("departments.rename_label", { name: department.name })}
              aria-describedby={hintId}
              aria-busy={saving || undefined}
              readOnly={saving}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              onBlur={onBlur}
              className="h-8 w-full sm:w-72"
            />
          </span>
        ) : (
          department.name
        )
      }
      meta={<span id={hintId}>{meta}</span>}
      actions={
        !canManage ? null : editing ? (
          // mousedown is prevented so pressing a button does not blur the
          // field first, which would save before "Hủy" could cancel.
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancel}
              aria-disabled={saving || undefined}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void commit()}
              aria-disabled={saving || undefined}
              aria-busy={saving || undefined}
            >
              {t("common.save")}
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
              <Pencil aria-hidden className="size-3.5" />
              {t("departments.rename")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled={childCount > 0 || undefined}
              aria-describedby={childCount > 0 ? hintId : undefined}
              onClick={() => onArchive(department)}
            >
              <Archive aria-hidden className="size-3.5" />
              {t("departments.archive")}
            </Button>
          </>
        )
      }
    />
  );
}
