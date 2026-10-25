"use client";

import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
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
import { AskUniMemoryRow } from "./ask-uni-memory-row";

const GROUPS = ["preference", "fact"] as const;
type Kind = (typeof GROUPS)[number];
const NEW: AiMemory = { id: "", kind: "fact", text: "", source: "", created_at: "", updated_at: "" };

/** The memory screen that replaces the conversation in the dock: the switch, the entries by group, edit, add, import, clear. */
export function AskUniMemory({ orgId }: { orgId: string }) {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.memory" });
  const { workspace } = useWorkspace();
  const setView = useAiPanelStore((s) => s.setView);
  const setPrefill = useAiPanelStore((s) => s.setComposerPrefill);
  const memory = useAiMemory(orgId);
  const create = useCreateAiMemory(orgId);
  const update = useUpdateAiMemory(orgId);
  const remove = useDeleteAiMemory(orgId);
  const clear = useClearAiMemory(orgId);
  const setOn = useSetAskUniMemory(workspace.id);
  const [adding, setAdding] = useState<Kind | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = memory.data?.entries ?? [];
  const limit = memory.data?.limit ?? 50;
  const fail = (err: unknown) => {
    const code = errorCode(err);
    setError(code === "ai_memory_full" ? t("full", { limit }) : t(`errors.${code}`, { defaultValue: t("errors.default") }));
  };
  const run = (call: Promise<unknown>) => {
    setError(null);
    return call.catch(fail);
  };

  const save = (e: AiMemory, patch: { kind: string; text: string }) =>
    void run(e.id === "" ? create.mutateAsync(patch) : update.mutateAsync({ id: e.id, body: patch }));
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="ask-uni-memory">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t("back")} onClick={() => setView("thread")}>
          <ArrowLeft aria-hidden />
        </Button>
        <h2 className="flex-1 text-title font-semibold">{t("title")}</h2>
        {memory.data ? <span className="text-caption text-muted-foreground">{t("count", { count: entries.length, limit })}</span> : null}
      </div>
      <div className="flex flex-col gap-4 p-3">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-caption text-muted-foreground">{t("switch_hint")}</p>
          <Switch
            aria-label={t("switch_label")}
            checked={memory.data?.on ?? true}
            disabled={setOn.isPending}
            onCheckedChange={(on) => setOn.mutate(on)}
          />
        </div>
        {memory.data && !memory.data.on ? <p className="text-caption text-muted-foreground">{t("off_note")}</p> : null}
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
          <div className="flex flex-col items-start gap-2">
            <p className="text-body font-medium">{t("empty_title")}</p>
            <p className="text-caption text-muted-foreground">{t("empty_description")}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={() => setAdding("preference")}>
                {t("add_entry")}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setView("memory-import")}>
                {t("import")}
              </Button>
            </div>
          </div>
        ) : null}
        {memory.data && (entries.length > 0 || adding !== null)
          ? GROUPS.map((kind) => (
              <section key={kind} className="flex flex-col gap-1">
                <h3 className="text-caption font-semibold text-muted-foreground">{t(`group_${kind}`)}</h3>
                <ul className="flex flex-col">
                  {entries
                    .filter((e) => e.kind === kind)
                    .map((e) => (
                      <AskUniMemoryRow key={e.id} entry={e} onSave={(p) => save(e, p)} onDelete={() => del(e)} />
                    ))}
                  {adding === kind ? (
                    <AskUniMemoryRow
                      entry={{ ...NEW, kind }}
                      startEditing
                      onSave={(p) => save(NEW, p)}
                      onDelete={() => setAdding(null)}
                      onCancel={() => setAdding(null)}
                    />
                  ) : null}
                </ul>
                <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => setAdding(kind)}>
                  <Plus aria-hidden />
                  {t("add")}
                </Button>
              </section>
            ))
          : null}
        {memory.data && (entries.length > 0 || adding !== null) ? (
          <div className="flex flex-col items-start gap-1 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPrefill(t("edit_prefill"));
                setView("thread");
              }}
            >
              {t("edit_by_chat")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setView("memory-import")}>
              {t("import")}
            </Button>
            {entries.length > 0 ? (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
                {t("clear_all")}
              </Button>
            ) : null}
            <p className="pt-2 text-caption text-muted-foreground">{t("footnote")}</p>
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
            <AlertDialogAction disabled={clear.isPending} onClick={clearAll}>
              {t("clear_confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
