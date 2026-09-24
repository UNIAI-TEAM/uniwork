"use client";

import { Milestone } from "lucide-react";
import { PillButton } from "../../common/pill-button";
import { PickerItem, PropertyPicker } from "./property-picker";

function stageOptions(stage: string | undefined, maxSiblingStage: number): string[] {
  const current = Number(stage);
  const normalized = Number.isSafeInteger(current) && current > 0 ? current : 0;
  const normalizedSibling = Number.isSafeInteger(maxSiblingStage) && maxSiblingStage > 0
    ? maxSiblingStage
    : 0;
  const desiredTop = Math.max(normalized, normalizedSibling, 2) + 1;
  const top = Math.min(desiredTop, 100);
  const options = Array.from({ length: top }, (_, index) => String(index + 1));
  if (normalized > top) options.push(String(normalized));
  if (desiredTop > top && desiredTop !== normalized) options.push(String(desiredTop));
  return options;
}

export function CreateTaskStageField({
  value,
  label,
  noneLabel,
  maxSiblingStage,
  open,
  onOpenChange,
  onChange,
}: {
  value: string | undefined;
  label: string;
  noneLabel: string;
  maxSiblingStage: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <PropertyPicker
      open={open}
      onOpenChange={onOpenChange}
      width="w-44"
      align="start"
      triggerRender={<PillButton aria-label={label} />}
      trigger={
        <>
          <Milestone className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{value ? `${label} ${value}` : label}</span>
        </>
      }
    >
      <PickerItem
        emptyValue
        selected={!value}
        onClick={() => {
          onChange(undefined);
          onOpenChange(false);
        }}
      >
        <Milestone className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-muted-foreground">{noneLabel}</span>
      </PickerItem>
      {stageOptions(value, maxSiblingStage).map((stage) => (
        <PickerItem
          key={stage}
          selected={stage === value}
          onClick={() => {
            onChange(stage);
            onOpenChange(false);
          }}
        >
          <Milestone className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{`${label} ${stage}`}</span>
        </PickerItem>
      ))}
    </PropertyPicker>
  );
}
