"use client";

import { useTranslation } from "react-i18next";
import { paths } from "@uniwork/core/paths";
import type { AiContextRef, Workspace } from "@uniwork/core/types";
import { cn } from "@uniwork/ui/lib/utils";
import { useOptionalWorkspace } from "../layout/workspace-context";
import { AppLink } from "../navigation";
import { entityKindIcon } from "./ask-uni-entity";

const CHIP = "inline-flex max-w-64 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-caption text-foreground";

/** The in-app page of an object a turn names, or null outside a workspace or for a kind with no page. */
export function askRefHref(ws: Workspace | undefined, r: Pick<AiContextRef, "kind" | "id">): string | null {
  const base = ws ? paths.workspace(ws.organization_slug, ws.slug) : null;
  switch (r.kind) {
    case "task": return base?.task(r.id) ?? null;
    case "project": return base?.project(r.id) ?? null;
    case "meeting": return base?.meeting(r.id) ?? null;
    case "document": return base?.document(r.id) ?? null;
    case "drive_file": return base?.documentsDriveFile(r.id) ?? null;
    case "member": return base?.person(r.id) ?? null;
    case "room": return base?.chatConversation(r.id) ?? null;
    default: return null;
  }
}

/** What a question was asked about: its page focus and @-mentions, as small chips that open the object. */
export function AskUniContextChips({ refs }: { refs: AiContextRef[] }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.entity.kind" });
  const ws = useOptionalWorkspace()?.workspace;
  if (refs.length === 0) return null;
  const href = (r: AiContextRef) => askRefHref(ws, r);
  return (
    <ul className="mt-1 flex flex-wrap justify-end gap-1">
      {refs.map((r) => {
        const Icon = entityKindIcon(r.kind === "room" ? "chat" : r.kind);
        const kindLabel = t(["task", "project", "meeting", "document", "drive_file", "member"].includes(r.kind) ? r.kind : r.kind === "room" ? "chat" : "other");
        const to = href(r);
        const body = (
          <>
            <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{r.title || kindLabel}</span>
          </>
        );
        return (
          <li key={`${r.kind}:${r.id}`}>
            {to ? (
              <AppLink href={to} aria-label={`${kindLabel}: ${r.title || kindLabel}`} className={cn(CHIP, "hover:bg-surface-hover")}>
                {body}
              </AppLink>
            ) : (
              <span className={CHIP}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
