"use client";

import { useState } from "react";
import { ChevronDown, Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAiMemory, useImportAiMemory, useSplitAiMemoryImport } from "@uniwork/core/ai/memory";
import type { AiMemoryImportSplit } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@uniwork/ui/components/ui/collapsible";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { AskUniMemoryReview } from "./ask-uni-memory-review";
import { runeCount, useMemoryErrorText } from "./ask-uni-memory-row";

const PASTE_MAX = 20000;

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-body">
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-caption font-medium text-primary">
        {n}
      </span>
      {children}
    </p>
  );
}

/**
 * The import, in place on the memory screen like ClickUp's "Bring your memories from another AI": copy the export
 * prompt, paste the other AI's answer, split it, then pick the lines to keep without leaving the screen.
 */
export function AskUniMemoryImport({ orgSlug, defaultOpen = false }: { orgSlug: string; defaultOpen?: boolean }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const memory = useAiMemory(orgSlug);
  const splitCall = useSplitAiMemoryImport(orgSlug);
  const importCall = useImportAiMemory(orgSlug);
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [split, setSplit] = useState<AiMemoryImportSplit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const message = useMemoryErrorText();
  // The server counts runes, so an emoji is one character here too.
  const chars = runeCount(text);

  const doSplit = async () => {
    setError(null);
    try {
      setSplit(await splitCall.mutateAsync(text));
    } catch (err) {
      setError(message(err, "importer.errors")); // the paste stays in the box
    }
  };

  // navigator.clipboard is undefined outside secure contexts, and a write can be refused.
  const copyPrompt = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(t("importer.prompt"));
      toast(t("importer.copied"));
    } catch {
      setError(t("importer.copy_failed"));
    }
  };

  const save = async (entries: { kind: string; text: string }[]) => {
    try {
      const res = await importCall.mutateAsync(entries);
      const skipped = res.skipped_duplicates;
      const count = entries.length - skipped;
      toast(skipped > 0 ? t("importer.added_skipped", { count, skipped }) : t("importer.added", { count }));
      setSplit(null);
      setText("");
      setOpen(false);
      return null;
    } catch (err) {
      return message(err, "errors");
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-1.5" data-slot="ask-uni-memory-import">
      <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md px-0.5 text-start text-caption font-semibold text-muted-foreground hover:text-foreground">
        <Download aria-hidden className="size-3.5" />
        <span className="flex-1">{t("importer.title")}</span>
        <ChevronDown aria-hidden className="size-4 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3">
          {split ? (
            memory.data ? (
              <AskUniMemoryReview split={split} remaining={memory.data.remaining} onSave={save} onPasteAgain={() => setSplit(null)} />
            ) : memory.isError ? (
              <div className="flex items-center gap-2 text-caption text-destructive">
                {t("load_error")}
                <Button type="button" variant="outline" size="sm" onClick={() => void memory.refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">{t("importer.loading")}</p>
            )
          ) : (
            <>
              <Step n={1}>{t("importer.step_copy")}</Step>
              <div className="flex flex-col gap-2 ps-7">
                {/* The clamp sits on the text, not the padded box, so no half line shows under it. */}
                <div className="rounded-md bg-muted/60 px-2.5 py-2">
                  <p className="line-clamp-4 text-caption whitespace-pre-wrap text-muted-foreground">{t("importer.prompt")}</p>
                </div>
                <Button type="button" size="sm" variant="outline" className="self-end" onClick={() => void copyPrompt()}>
                  <Copy aria-hidden />
                  {t("importer.copy")}
                </Button>
              </div>
              <Step n={2}>{t("importer.step_paste")}</Step>
              <div className="flex flex-col gap-2 ps-7">
                <Textarea
                  aria-label={t("importer.paste_label")}
                  placeholder={t("importer.paste_placeholder")}
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-caption text-muted-foreground">{t("importer.chars", { count: chars, max: PASTE_MAX })}</span>
                  <Button
                    type="button"
                    size="sm"
                    disabled={text.trim() === "" || chars > PASTE_MAX || splitCall.isPending}
                    onClick={() => void doSplit()}
                  >
                    {splitCall.isPending ? t("importer.splitting") : t("importer.split")}
                  </Button>
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-caption text-destructive">
                  {error}
                </p>
              ) : null}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
