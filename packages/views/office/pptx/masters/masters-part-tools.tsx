"use client";

/**
 * Part-level tools of the slide master view (UNI-939 T01): rename the active
 * master/layout and add a placeholder to it. Each action emits one
 * `MasterPanelEdit`; the parent remounts this (via `key`) when the part or its
 * name changes, so the name draft always seeds from the current part.
 */
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Label } from "@uniwork/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@uniwork/ui/components/ui/select";
import {
  MASTER_NEW_PLACEHOLDER_BOX,
  MASTER_PLACEHOLDER_CHOICES,
  type MasterPanelEdit,
  type MasterPartView,
  type MasterPlaceholderChoice,
} from "./masters-model";

interface MastersPartToolsProps {
  part: MasterPartView;
  disabled: boolean;
  onEdit: (edit: MasterPanelEdit) => void;
}

const isChoice = (value: unknown): value is MasterPlaceholderChoice =>
  typeof value === "string" && (MASTER_PLACEHOLDER_CHOICES as readonly string[]).includes(value);

export function MastersPartTools({ part, disabled, onEdit }: MastersPartToolsProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const id = useId();
  const [name, setName] = useState(part.name);
  const [placeholder, setPlaceholder] = useState<MasterPlaceholderChoice>("body");
  const trimmed = name.trim();
  const items = useMemo(
    () => MASTER_PLACEHOLDER_CHOICES.map((choice) => ({ value: choice, label: t("masters.placeholder_" + choice.toLowerCase()) })),
    [t],
  );

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-2" data-pptx-masters-part-tools>
      <form
        className="flex flex-col gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && trimmed && trimmed !== part.name) onEdit({ op: "master_rename", part: part.partPath, name: trimmed });
        }}
      >
        <Label htmlFor={id + "-name"} className="text-caption font-medium text-muted-foreground">
          {part.kind === "layout" ? t("masters.rename_layout") : t("masters.rename_master")}
        </Label>
        <div className="flex items-center gap-2">
          <Input id={id + "-name"} value={name} maxLength={255} disabled={disabled} onChange={(event) => setName(event.target.value)} className="h-8 min-w-0 flex-1" />
          <Button type="submit" size="sm" variant="outline" disabled={disabled || !trimmed || trimmed === part.name} data-pptx-masters-rename>
            {t("masters.rename_apply")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-1">
        <Label htmlFor={id + "-ph"} className="text-caption font-medium text-muted-foreground">
          {t("masters.add_placeholder_label")}
        </Label>
        <div className="flex items-center gap-2">
          <Select value={placeholder} items={items} onValueChange={(value) => { if (isChoice(value)) setPlaceholder(value); }}>
            <SelectTrigger id={id + "-ph"} aria-label={t("masters.add_placeholder_label")} className="min-w-0 flex-1" disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-pptx-masters-add-placeholder
            onClick={() => onEdit({ op: "master_add_placeholder", part: part.partPath, placeholder, box: MASTER_NEW_PLACEHOLDER_BOX })}
          >
            {t("masters.add_placeholder")}
          </Button>
        </div>
      </div>
    </div>
  );
}
