"use client";

import { useState } from "react";
import { Brain, MessageSquareText, Plus, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAiPanelStore } from "@uniwork/core/ai";
import { errorCode } from "@uniwork/core/api/http";
import { useAiMemory, useClearAiMemory, useCreateAiMemory, useDeleteAiMemory, useSetAskUniMemory, useUpdateAiMemory } from "@uniwork/core/ai/memory";
import type { AiMemory } from "@uniwork/core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@uniwork/ui/components/ui/alert-dialog";
import { Button } from "@uniwork/ui/components/ui/button";
import { Switch } from "@uniwork/ui/components/ui/switch";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniMemoryImport } from "./ask-uni-memory-import";
import { AskUniMemoryRow, useMemoryErrorText } from "./ask-uni-memory-row";

const GROUPS = ["preference", "fact"] as const;
type Kind = (typeof GROUPS)[number];
const GROUP_ICONS = { preference: MessageSquareText, fact: UserRound } as const;
const NEW: AiMemory = { id: "", kind: "fact", text: "", source: "", created_at: "", updated_at: "" };
const CARD = "rounded-xl border border-border bg-card";

/**
 * The memory screen that replaces the conversation in the dock, laid out like ClickUp's "Memories & Preferences":
 * a title and what it is for, the switch, one card per group, the import in place, and clearing at the bottom.
 */
export function AskUniMemory({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const { workspace } = useWorkspace();
  const openMemoryHelp = useAiPanelStore((s) => s.openMemoryHelp);
  const memory = useAiMemory(orgSlug);
  const create = useCreateAiMemory(orgSlug);
  const update = useUpdateAiMemory(orgSlug);
  const remove = useDeleteAiMemory(orgSlug);
  const clear = useClearAiMemory(orgSlug);
  const setOn = useSetAskUniMemory(workspace.id);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorText = useMemoryErrorText();

  const entries = memory.data?.entries ?? [];
  const limit = memory.data?.limit ?? 50;
  const message = (err: unknown) => (errorCode(err) === "ai_memory_full" ? t("full", { limit }) : errorText(err));
  const fail = (err: unknown) => setError(message(err));
  const run = (call: Promise<unknown>) => {
    setError(null);
    return call.catch(fail);
  };

  // The row keeps its editor open on a refusal and shows this text itself.
  const save = async (e: AiMemory, patch: { kind: string; text: string }) => {
    setError(null);
    try {
      await (e.id === "" ? create.mutateAsync(patch) : update.mutateAsync({ id: e.id, body: patch }));
      return null;
    } catch (err) {
      return message(err);
    }
  };
  const del = (e: AiMemory) =>
    void run(
      remove.mutateAsync(e.id).then(() =>
        toast(t("deleted"), {
          action: { label: t("undo"), onClick: () => void run(create.mutateAsync({ kind: e.kind, text: e.text })) },
        }),
      ),
    );
  const clearAll = () =>
    void run(clear.mutateAsync().then((n) => toast(t("cleared_other", { count: n })))).finally(() => setConfirming(false));

  const showGroups = memory.data && (entries.length > 0 || adding !== null);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="ask-uni-memory">
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <h2 className="flex-1 text-title font-semibold">{t("title")}</h2>
            {memory.data ? <span className="text-caption text-muted-foreground">{t("count", { count: entries.length, limit })}</span> : null}
          </div>
          <p className="text-caption text-muted-foreground">{t("switch_hint")}</p>
        </div>
        <div className={`${CARD} flex items-center gap-3 px-3 py-2.5`}>
          <span className="flex-1 text-body">{t("switch_title")}</span>
          <Switch
            aria-label={t("switch_label")}
            checked={memory.data?.on ?? true}
            disabled={setOn.isPending}
            onCheckedChange={(on) => setOn.mutate(on)}
          />
        </div>
        {memory.data && !memory.data.on ? <p className="-mt-2 text-caption text-muted-foreground">{t("off_note")}</p> : null}
        {error ? (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        ) : null}
        {memory.isError ? (
          <div className="flex items-center gap-2 text-caption text-destructive">
            {t("load_error")}
            <Button type="button" variant="outline" size="sm" onClick={() => void memory.refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : null}
        {memory.data && entries.length === 0 && adding === null ? (
          <div className={`${CARD} flex flex-col items-center gap-2 px-4 py-6 text-center`}>
            <Brain aria-hidden className="size-6 text-muted-foreground" />
            <p className="text-body font-medium">{t("empty_title")}</p>
            <p className="text-caption text-muted-foreground">{t("empty_description")}</p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button type="button" size="sm" onClick={openMemoryHelp}>
                <Sparkles aria-hidden />
                {t("talk_to_uni")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding("preference")}>
                <Plus aria-hidden />
                {t("add_entry")}
              </Button>
            </div>
          </div>
        ) : null}
        {memory.data && entries.length > 0 ? (
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={openMemoryHelp}>
            <Sparkles aria-hidden />
            {t("edit_by_chat")}
          </Button>
        ) : null}
        {showGroups
          ? GROUPS.map((kind) => {
              const Icon = GROUP_ICONS[kind];
              const rows = entries.filter((e) => e.kind === kind);
              return (
                <section key={kind} aria-labelledby={`ask-uni-memory-${kind}`} className="flex flex-col gap-1.5">
                  <h3 id={`ask-uni-memory-${kind}`} className="flex items-center gap-1.5 px-0.5 text-caption font-semibold text-muted-foreground">
                    <Icon aria-hidden className="size-3.5" />
                    {t(`group_${kind}`)}
                    <span className="font-normal">· {rows.length}</span>
                  </h3>
                  <ul className={`${CARD} flex flex-col divide-y divide-border overflow-hidden`}>
                    {rows.map((e) => (
                      <AskUniMemoryRow key={e.id} entry={e} onSave={(p) => save(e, p)} onDelete={() => del(e)} />
                    ))}
                    {adding === kind ? (
                      <AskUniMemoryRow
                        entry={{ ...NEW, kind }}
                        startEditing
                        onSave={(p) => save(NEW, p)}
                        onCancel={() => setAdding(null)}
                      />
                    ) : (
                      <li>
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 px-3 py-2 text-start text-body text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => setAdding(kind)}
                        >
                          <Plus aria-hidden className="size-4" />
                          {t("add_entry")}
                        </button>
                      </li>
                    )}
                  </ul>
                </section>
              );
            })
          : null}
        {memory.data ? <AskUniMemoryImport orgSlug={orgSlug} defaultOpen={entries.length === 0} /> : null}
        {entries.length > 0 ? (
          <div className="flex flex-col items-start gap-0.5 border-t border-border pt-3">
            <Button type="button" variant="link" size="sm" className="h-auto px-0 text-destructive" onClick={() => setConfirming(true)}>
              {t("clear_all")}
            </Button>
            <p className="text-caption text-muted-foreground">{t("footnote")}</p>
          </div>
        ) : null}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("clear_title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("clear_description_other", { count: entries.length })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clear.isPending}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={clear.isPending} onClick={clearAll}>
              {t("clear_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
