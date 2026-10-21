"use client";

import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAiCapabilities } from "@uniwork/core/ai";
import { useAskModelChoice } from "@uniwork/core/ai/model-choice";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@uniwork/ui/components/ui/dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@uniwork/ui/components/ui/hover-card";
import { cn } from "@uniwork/ui/lib/utils";
import { useWorkspace } from "../layout/workspace-context";

const EFFORTS = ["", "low", "medium", "high"] as const;
const STEPS = [1, 2, 3, 4, 5];

/** The asker's choice made safe for sending: a model the organization has switched off reads as Auto. */
export function useAskModelSelection(wsId: string) {
  const caps = useAiCapabilities(wsId).data;
  const { model, effort } = useAskModelChoice();
  const enabled = (caps?.models ?? []).filter((m) => m.enabled);
  const effective = enabled.some((m) => m.key === model) ? model : "";
  return { enabled, model: effective, effort, autoModel: caps?.auto_model ?? "" };
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

function ModelItem({ modelKey, speed, intelligence, cost }: { modelKey: string; speed: number; intelligence: number; cost: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={0}
        render={<DropdownMenuRadioItem value={modelKey} />}
      >
        {t(`models.${modelKey}.name`, { defaultValue: modelKey })}
      </HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="flex w-60 flex-col gap-2">
        <p className="text-body">{t(`models.${modelKey}.description`, { defaultValue: "" })}</p>
        <Bar label={t("model.speed")} value={speed} />
        <Bar label={t("model.intelligence")} value={intelligence} />
        <Bar label={t("model.cost")} value={cost} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** Model and effort choice for Ask UNI (R17); remembered per device. */
export function AskUniModelPicker() {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const { workspace } = useWorkspace();
  const { enabled, model, effort, autoModel } = useAskModelSelection(workspace.id);
  const setModel = useAskModelChoice((s) => s.setModel);
  const setEffort = useAskModelChoice((s) => s.setEffort);
  const name = (key: string) => t(`models.${key}.name`, { defaultValue: key });
  const current = model ? name(model) : t("model.auto");
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" aria-label={t("model.label_with", { model: current })} />}
        >
          {current}
          <ChevronDown aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="min-w-56">
          <DropdownMenuRadioGroup value={model} onValueChange={(v) => setModel(String(v))}>
            <DropdownMenuRadioItem value="">
              {autoModel ? t("model.auto_current", { model: name(autoModel) }) : t("model.auto")}
            </DropdownMenuRadioItem>
            {enabled.map((m) => (
              <ModelItem key={m.key} modelKey={m.key} speed={m.speed} intelligence={m.intelligence} cost={m.cost} />
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>{t("model.effort")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup value={effort} onValueChange={(v) => setEffort(String(v))}>
                {EFFORTS.map((e) => (
                  <DropdownMenuRadioItem key={e} value={e}>
                    {t(`model.effort_${e || "auto"}`)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      {model === "opus" ? (
        <p role="status" className="basis-full text-caption text-muted-foreground">
          {t("model.opus_note")}
        </p>
      ) : null}
    </>
  );
}
