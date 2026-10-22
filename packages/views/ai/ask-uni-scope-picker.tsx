"use client";

import { useState, type RefObject } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFlag } from "@uniwork/core/feature-flags";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { useWorkspace } from "../layout/workspace-context";
import { useDocumentMatches, useMeetingMatches, useProjectMatches, useRoomMatches, type LookupItem } from "./ask-uni-lookup";

type ScopeKind = "project" | "meeting" | "document" | "room";

interface ScopePick {
  kind: ScopeKind;
  id: string;
  title: string;
}

function ScopeList({ onPick }: { onPick: (pick: ScopePick) => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.scope" });
  const { workspace } = useWorkspace();
  const documentsOn = useFlag("documents", false);
  const [q, setQ] = useState("");
  const all: { kind: ScopeKind; title: string; items: LookupItem[] }[] = [
    { kind: "project", title: t("projects"), items: useProjectMatches(workspace.id, q, true).items },
    { kind: "meeting", title: t("meetings"), items: useMeetingMatches(workspace.id, q, true).items },
    { kind: "document", title: t("documents"), items: useDocumentMatches(workspace.id, q, documentsOn).items },
    { kind: "room", title: t("rooms"), items: useRoomMatches(workspace.id, q, true) },
  ];
  const groups = all.filter((g) => g.items.length > 0);
  return (
    <>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
      <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {groups.length === 0 ? <p className="px-1 py-1.5 text-caption text-muted-foreground">{t("empty")}</p> : null}
        {groups.map((g) => (
          <div key={g.kind} role="group" aria-label={g.title} className="flex flex-col">
            <p className="px-1.5 pt-1 pb-0.5 text-caption font-medium text-muted-foreground">{g.title}</p>
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick({ kind: g.kind, id: item.id, title: item.title })}
                className="truncate rounded-md px-1.5 py-1.5 text-left text-body hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
              >
                {item.title}
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

/** The "+" button: one project, meeting, document or chat room becomes the question's focus. */
export function AskUniScopePicker({ onPick, finalFocus }: { onPick: (pick: ScopePick) => void; finalFocus: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.scope" });
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("add")} />}
      >
        <Plus aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72" aria-label={t("title")} finalFocus={finalFocus}>
        <ScopeList
          onPick={(pick) => {
            onPick(pick);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
