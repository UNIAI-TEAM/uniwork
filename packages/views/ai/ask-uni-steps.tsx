"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AiStep } from "@uniwork/core/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { SafeMarkdown } from "@uniwork/ui/markdown";

// The tools the server names (metrics/ai_ask.go askTools); a wire value outside this set never becomes a key.
const TOOLS = new Set([
  "search", "list_tasks", "get_task", "list_meetings", "get_meeting", "list_projects",
  "get_project", "get_document", "list_chat_rooms", "read_chat_room", "list_members", "member_workload", "propose_memory",
  "list_documents", "list_templates",
]);

/** The sentence for one step under `progress` or `steps_done`: blank tool is the server's retry, unknown tool the generic one. */
function stepKey(step: AiStep): string {
  if (step.tool === "") return "retry";
  if (!TOOLS.has(step.tool)) return "default";
  return step.label ? `${step.tool}_label` : step.tool;
}

const noLinks = () => false;
const plainLink = ({ children }: { children: ReactNode }) => children;

/** A thinking summary: the model's own Markdown, quiet, and with no link it could slip in. */
function Thought({ text }: { text: string }) {
  return (
    <SafeMarkdown
      isLinkAllowed={noLinks}
      renderLink={plainLink}
      className="text-caption text-muted-foreground [&_p]:my-0.5 [&_p]:leading-5 [&_strong]:font-medium [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
    >
      {text}
    </SafeMarkdown>
  );
}

/**
 * How UNI got there, in order: each step's thinking, the step itself and the sentence the model wrote before it; a
 * think step is the thinking before the answer, and `thinking` the current call's, still being written. `current` is
 * the step the status line above already names, so its own line is not said twice.
 */
function Timeline({ steps, thinking = "", current = -1 }: { steps: AiStep[]; thinking?: string; current?: number }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  return (
    <ol className="mt-1.5 ms-1.5 flex flex-col gap-2 border-s border-border ps-3 text-caption text-muted-foreground">
      {steps.map((s, i) => (
        // Steps are append-only and can repeat, so the index is the identity.
        <li key={i} className="flex min-w-0 flex-col gap-1 break-words">
          {s.thought ? <Thought text={s.thought} /> : null}
          {s.kind === "think" || i === current ? null : <p className="font-medium">{t(`steps_done.${stepKey(s)}`, { label: s.label })}</p>}
          {s.note ? <p>{s.note}</p> : null}
        </li>
      ))}
      {thinking ? (
        <li className="min-w-0 break-words">
          <Thought text={thinking} />
        </li>
      ) : null}
    </ol>
  );
}

/**
 * What UNI is doing, in words. Running: one line that never goes blank (thinking, the last step, writing), with the
 * timeline under it once there is thinking or a note to show, until the answer starts. Done: "Xong sau n bước" (or
 * "Đã suy nghĩ") that opens to the timeline.
 */
export function AskUniProgress({ steps, running, writing, thinking = "" }: { steps: AiStep[]; running: boolean; writing: boolean; thinking?: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const tools = steps.filter((s) => s.kind !== "think");
  const detailed = thinking !== "" || steps.some((s) => Boolean(s.thought || s.note));
  const live = useRef<HTMLDivElement>(null);
  // While it is written the timeline follows its newest line.
  useEffect(() => {
    const el = live.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thinking, steps.length]);
  if (running) {
    const last = tools[tools.length - 1];
    const naming = !writing && !thinking && last !== undefined;
    const text = writing
      ? t("progress.writing")
      : !naming
        ? t("progress.thinking")
        : t(`progress.${stepKey(last)}`, { label: last.label });
    return (
      <div className="mb-2">
        <div role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
          <Spinner className="size-3.5" />
          <span className="min-w-0 break-words">{text}</span>
        </div>
        {/* Once the answer is being written it has the reader's eye; the timeline waits behind "Xong sau n bước". */}
        {detailed && !writing ? (
          <div ref={live} className="max-h-60 overflow-y-auto">
            <Timeline steps={steps} thinking={thinking} current={naming ? steps.lastIndexOf(last) : -1} />
          </div>
        ) : null}
      </div>
    );
  }
  if (steps.length === 0) return null;
  return (
    <Collapsible className="mb-2">
      <CollapsibleTrigger className="group/steps inline-flex items-center gap-1 rounded-md text-caption text-muted-foreground hover:text-foreground">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/steps:rotate-90" />
        {tools.length > 0 ? t("steps_done.summary", { count: tools.length }) : t("steps_done.thought_only")}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Timeline steps={steps} />
      </CollapsibleContent>
    </Collapsible>
  );
}
