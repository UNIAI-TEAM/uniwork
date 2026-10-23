"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiStep } from "@uniwork/core/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { Spinner } from "@uniwork/ui/components/ui/spinner";

// The tools the server names (metrics/ai_ask.go askTools); a wire value outside this set never becomes a key.
const TOOLS = new Set([
  "search", "list_tasks", "get_task", "list_meetings", "get_meeting", "list_projects",
  "get_project", "get_document", "list_chat_rooms", "read_chat_room", "list_members", "member_workload",
]);

/** The sentence for one step under `progress` or `steps_done`: blank tool is the server's retry, unknown tool the generic one. */
function stepKey(step: AiStep): string {
  if (step.tool === "") return "retry";
  if (!TOOLS.has(step.tool)) return "default";
  return step.label ? `${step.tool}_label` : step.tool;
}

/**
 * What UNI is doing, in words. Running: one line that never goes blank (thinking, the last step, writing).
 * Done: "Xong sau n bước" that opens to one line per step.
 */
export function AskUniProgress({ steps, running, writing }: { steps: AiStep[]; running: boolean; writing: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  if (running) {
    const last = steps[steps.length - 1];
    const text = writing ? t("progress.writing") : last ? t(`progress.${stepKey(last)}`, { label: last.label }) : t("progress.thinking");
    return (
      <div role="status" className="mb-2 flex items-center gap-2 text-caption text-muted-foreground">
        <Spinner className="size-3.5" />
        <span className="min-w-0 break-words">{text}</span>
      </div>
    );
  }
  if (steps.length === 0) return null;
  return (
    <Collapsible className="mb-2">
      <CollapsibleTrigger className="group/steps inline-flex items-center gap-1 rounded-md text-caption text-muted-foreground hover:text-foreground">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/steps:rotate-90" />
        {t("steps_done.summary", { count: steps.length })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 ms-5 list-disc text-caption text-muted-foreground">
          {steps.map((s, i) => (
            // Steps are append-only and can repeat, so the index is the identity.
            <li key={i} className="break-words">{t(`steps_done.${stepKey(s)}`, { label: s.label })}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
