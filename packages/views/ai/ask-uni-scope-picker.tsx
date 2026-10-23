"use client";

import { useId, useRef, useState, type ComponentProps } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Input } from "@uniwork/ui/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { useWorkspace } from "../layout/workspace-context";
import {
  AskUniObjectPicker,
  type AskUniObjectKind,
  type AskUniObjectPickerHandle,
} from "./ask-uni-object-picker";

type ScopeKind = Exclude<AskUniObjectKind, "member">;
const SCOPE_KINDS: ScopeKind[] = ["task", "project", "meeting", "document", "room"];

interface ScopePick {
  kind: ScopeKind;
  id: string;
  title: string;
}

function ScopeList({ onPick, onDismiss }: { onPick: (pick: ScopePick) => void; onDismiss: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.scope" });
  const { workspace } = useWorkspace();
  const [q, setQ] = useState("");
  const picker = useRef<AskUniObjectPickerHandle>(null);
  const listboxId = useId();
  const [activeId, setActiveId] = useState<string>();
  return (
    <>
      <Input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (picker.current?.onKeyDown(e.nativeEvent)) e.preventDefault();
        }}
        placeholder={t("search")}
        aria-label={t("search")}
      />
      <AskUniObjectPicker
        ref={picker}
        wsId={workspace.id}
        query={q}
        kinds={SCOPE_KINDS}
        onPick={(item) => onPick({ kind: item.kind as ScopeKind, id: item.id, title: item.title })}
        onDismiss={onDismiss}
        listboxId={listboxId}
        onActiveChange={setActiveId}
      />
    </>
  );
}

/** The "+" button: one project, meeting, document or chat room becomes the question's focus. */
export function AskUniScopePicker({
  onPick,
  finalFocus,
}: {
  onPick: (pick: ScopePick) => void;
  /** Where focus goes when the list closes (Base UI `finalFocus`). */
  finalFocus: ComponentProps<typeof PopoverContent>["finalFocus"];
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.scope" });
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("add")} />}
      >
        <Plus aria-hidden />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-96" aria-label={t("title")} finalFocus={finalFocus}>
        <ScopeList
          onPick={(pick) => {
            onPick(pick);
            setOpen(false);
          }}
          onDismiss={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
