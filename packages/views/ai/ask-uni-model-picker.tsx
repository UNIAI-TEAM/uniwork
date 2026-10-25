"use client";

import { useState, type MouseEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";
import { askLook, AskUniProviderMark, type AskLook } from "./ask-uni-provider";

const EFFORTS = ["", "low", "medium", "high"] as const;
const STEPS = [1, 2, 3, 4, 5];

/**
 * The asker's choice made safe for sending: a model the organization has switched off reads as Auto. `look` is the
 * chosen model's provider look, null for Auto.
 */
export function useAskModelSelection(wsId: string) {
  const caps = useAiCapabilities(wsId).data;
  const { model, effort } = useAskModelChoice();
  const enabled = (caps?.models ?? []).filter((m) => m.enabled);
  const chosen = enabled.find((m) => m.key === model);
  return { enabled, model: chosen ? model : "", effort, autoModel: caps?.auto_model ?? "", look: askLook(chosen?.provider) };
}

function Bar({ label, value }: { label: string; value: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.model" });
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <div className="flex items-center justify-between gap-3 text-caption text-muted-foreground">
      <span>{label}</span>
      <span role="img" aria-label={t("bar", { label, value: filled })} className="flex gap-0.5">
        {STEPS.map((s) => (
          <span key={s} aria-hidden className={cn("h-1.5 w-4 rounded-full", s <= filled ? "bg-foreground" : "bg-muted")} />
        ))}
      </span>
    </div>
  );
}

interface Row {
  modelKey: string;
  /** The model's name alone, for the card; the row's label may add the model Auto runs today. */
  name: string;
  label: string;
  description: string;
  look: AskLook | null;
  bars?: { speed: number; intelligence: number; cost: number };
}

/**
 * One model: a click picks it; its flyout (hover, or a click by touch or keyboard) holds the card and sets the
 * effort with it, as ClickUp Brain does. The chosen row is marked current and shows its effort.
 */
function ModelRow({ row, chosen, effort, onPick }: { row: Row; chosen: boolean; effort: string; onPick: (key: string, effort?: string, close?: boolean) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        aria-current={chosen || undefined}
        // A mouse click is the pick; a tap or Enter picks too but leaves the flyout open for the effort.
        onClick={(e: MouseEvent) => onPick(row.modelKey, undefined, (e.nativeEvent as PointerEvent).pointerType === "mouse")}
      >
        <AskUniProviderMark look={row.look} size={14} />
        <span className="min-w-0 flex-1 truncate">{row.label}</span>
        {chosen ? (
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            {t(`model.effort_${effort || "auto"}`)}
            <Check aria-hidden className="size-3.5" />
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent side="left" className="flex w-60 flex-col gap-2 p-2">
        <p className="flex items-center gap-1.5 px-1.5 pt-0.5 text-body font-medium text-foreground">
          <AskUniProviderMark look={row.look} size={14} />
          {row.name}
        </p>
        <p className="px-1.5 text-body text-foreground">{row.description}</p>
        {row.bars ? (
          <div className="flex flex-col gap-1 px-1.5">
            <Bar label={t("model.speed")} value={row.bars.speed} />
            <Bar label={t("model.intelligence")} value={row.bars.intelligence} />
            <Bar label={t("model.cost")} value={row.bars.cost} />
          </div>
        ) : null}
        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuRadioGroup value={effort} onValueChange={(v) => onPick(row.modelKey, String(v), true)}>
          <DropdownMenuLabel>{t("model.effort")}</DropdownMenuLabel>
          {EFFORTS.map((e) => (
            <DropdownMenuRadioItem key={e} value={e}>
              {t(`model.effort_${e || "auto"}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** Model and effort choice for Ask UNI (R17); remembered per device. */
export function AskUniModelPicker() {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const { enabled, model, effort, autoModel, look } = useAskModelSelection(workspace.id);
  const setModel = useAskModelChoice((s) => s.setModel);
  const setEffort = useAskModelChoice((s) => s.setEffort);
  const [open, setOpen] = useState(false);
  const name = (key: string) => t(`models.${key}.name`, { defaultValue: key });
  const chosen = model ? name(model) : t("model.auto");
  const current = effort ? `${chosen} · ${t(`model.effort_${effort}`)}` : chosen;
  const pick = (key: string, e?: string, close = false) => {
    setModel(key);
    if (e !== undefined) setEffort(e);
    if (close) setOpen(false);
  };
  const rows: Row[] = [
    {
      modelKey: "",
      name: t("model.auto"),
      label: autoModel ? t("model.auto_current", { model: name(autoModel) }) : t("model.auto"),
      description: t("model.auto_description"),
      look: null,
    },
    ...enabled.map((m) => ({
      modelKey: m.key,
      name: name(m.key),
      label: name(m.key),
      description: t(`models.${m.key}.description`, { defaultValue: "" }),
      look: askLook(m.provider),
      bars: { speed: m.speed, intelligence: m.intelligence, cost: m.cost },
    })),
  ];
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" aria-label={t("model.label_with", { model: current })} />}
      >
        <AskUniProviderMark look={look} size={14} />
        {current}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-60">
        {rows.map((row) => (
          <ModelRow key={row.modelKey || "auto"} row={row} chosen={row.modelKey === model} effort={effort} onPick={pick} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
