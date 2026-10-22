"use client";

import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";

// The kinds the server counts that mean something to a reader (askuni_agent_tools.go); "member" is not a document.
const KINDS = ["task", "meeting", "document", "project", "chat"] as const;

/** "Đã xem 24 task, 3 cuộc họp" built from the summed step counts; collapses to the per-kind lines. */
export function AskUniSteps({ counts }: { counts: Record<string, number> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai" });
  const parts = KINDS.filter((k) => (counts[k] ?? 0) > 0).map((k) => t(`steps.${k}`, { count: counts[k] }));
  if (parts.length === 0) return null;
  return (
    <Collapsible className="mb-2">
      <CollapsibleTrigger className="group/steps inline-flex items-center gap-1 rounded-md text-caption text-muted-foreground hover:text-foreground">
        <ChevronRight aria-hidden className="size-3.5 transition-transform group-data-[panel-open]/steps:rotate-90" />
        {t("steps.seen", { list: parts.join(", ") })}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1 ms-5 list-disc text-caption text-muted-foreground">
          {parts.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
