"use client";

import { useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import { useAiMemory, useImportAiMemory, useSplitAiMemoryImport } from "@uniwork/core/ai/memory";
import type { AiMemoryImportSplit } from "@uniwork/core/types";
import { Button } from "@uniwork/ui/components/ui/button";
import { Textarea } from "@uniwork/ui/components/ui/textarea";
import { AskUniMemoryReview } from "./ask-uni-memory-review";

const PASTE_MAX = 20000;

/** The import screen in the dock: copy the export prompt, paste the other AI's answer, split it, review it, save it. */
export function AskUniMemoryImport({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const setView = useAiPanelStore((s) => s.setView);
  const memory = useAiMemory(orgSlug);
  const splitCall = useSplitAiMemoryImport(orgSlug);
  const importCall = useImportAiMemory(orgSlug);
  const [text, setText] = useState("");
  const [split, setSplit] = useState<AiMemoryImportSplit | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (err: unknown, scope: "errors" | "importer.errors") => {
    const code = errorCode(err);
    return t(`${scope}.${code}`, { defaultValue: t("errors.default") });
  };

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
      setView("memory");
      return null;
    } catch (err) {
      return message(err, "errors");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="ask-uni-memory-import">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("importer.back")} onClick={() => (split ? setSplit(null) : setView("memory"))}>
          <ArrowLeft aria-hidden />
        </Button>
        <h2 className="flex-1 text-title font-semibold">{t("importer.title")}</h2>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {split ? (
          memory.data ? (
            <AskUniMemoryReview split={split} remaining={memory.data.remaining} onSave={save} />
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
            <p className="text-caption text-muted-foreground">{t("importer.step_hint")}</p>
            <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2">
              <p className="whitespace-pre-wrap text-caption">{t("importer.prompt")}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={() => void copyPrompt()}
              >
                <Copy aria-hidden />
                {t("importer.copy")}
              </Button>
            </div>
            <Textarea
              aria-label={t("importer.paste_label")}
              placeholder={t("importer.paste_placeholder")}
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <span className="flex-1 text-caption text-muted-foreground">{t("importer.chars", { count: text.length, max: PASTE_MAX })}</span>
              <Button
                type="button"
                disabled={text.trim() === "" || text.length > PASTE_MAX || splitCall.isPending}
                onClick={() => void doSplit()}
              >
                {splitCall.isPending ? t("importer.splitting") : t("importer.split")}
              </Button>
            </div>
            {error ? (
              <p role="alert" className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
