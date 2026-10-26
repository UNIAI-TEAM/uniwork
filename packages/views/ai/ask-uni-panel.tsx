"use client";

import { Upload } from "lucide-react";
import { useAiCapabilities, useAiPanelStore } from "@uniwork/core/ai";
import { useAskUniStream } from "@uniwork/core/ai/stream";
import { useTranslation } from "react-i18next";
import { useFileDropZone } from "../editor/use-file-drop-zone";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniComposer } from "./ask-uni-composer";
import { AskUniEmptyState } from "./ask-uni-empty";
import { AskUniHeader } from "./ask-uni-header";
import { AskUniMemory } from "./ask-uni-memory";
import { AskUniMemoryHelp } from "./ask-uni-memory-help";
import { useAskModelSelection } from "./ask-uni-model-picker";
import { useEffectiveFocus } from "./ask-uni-page-context";
import { AskUniSourcesBar } from "./ask-uni-sources-bar";
import { AskUniThread } from "./ask-uni-thread";
import { useAskUniAttachments } from "./use-ask-uni-attachments";

/**
 * Over the dock while files are dragged onto it; it never takes the drop itself. The text pairs `brand-subtle` with
 * its own foreground: a provider's look re-points `--brand` but not `--brand-subtle` (tokens.css), so `text-brand`
 * here would sit on the wrong tint.
 */
function DropOverlay() {
  const { t } = useTranslation(undefined, { keyPrefix: "ai.attachments" });
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand bg-brand-subtle text-body-lg font-semibold text-brand-subtle-foreground"
    >
      <Upload aria-hidden className="size-5" />
      {t("drop_overlay")}
    </div>
  );
}

/** The docked Ask UNI panel (flag ask_uni_stream): header, the conversation and the composer. */
export function AskUniPanel() {
  const { workspace } = useWorkspace();
  const { i18n } = useTranslation();
  const conversationId = useAiPanelStore((s) => s.conversationId);
  const view = useAiPanelStore((s) => s.view);
  const memoryView = view === "memory";
  const memoryHelp = useAiPanelStore((s) => s.memoryHelp);
  const setMemoryHelp = useAiPanelStore((s) => s.setMemoryHelp);
  // The panel owns the stream so the thread and the composer share one live turn.
  const stream = useAskUniStream(workspace.id);
  const { model, effort, look } = useAskModelSelection(workspace.id);
  const focus = useEffectiveFocus();
  const streaming = stream.state.status === "streaming";
  // Files are read on the agent path only: the capability says whether the server takes them.
  const canAttach = !!useAiCapabilities(workspace.id).data?.attachments;
  const attachments = useAskUniAttachments(workspace.id);
  const { isDragOver, dropZoneProps } = useFileDropZone({ onDrop: attachments.attach, enabled: canAttach && !memoryView });
  // The hook prevents the default of every drag it sees, so with attaching off the dock gets none of its handlers.
  const memoryDrop = canAttach && !memoryView;
  const dropHandlers = memoryDrop ? dropZoneProps : undefined;
  // A new conversation with nothing in flight starts from suggestions for the open page.
  const empty = conversationId === null && stream.state.status === "idle";
  const askSuggestion = (question: string) =>
    void stream.ask({ question, focus: focus ? { kind: focus.kind, id: focus.id } : undefined, mentions: [], model, effort, locale: i18n.language });
  return (
    // A provider's look re-points the panel's colour slots (tokens.css); Auto keeps UNI's.
    <div
      className="relative flex h-full min-h-0 flex-col bg-background"
      data-slot="ask-uni-panel"
      data-ask-provider={look ?? undefined}
      {...dropHandlers}
    >
      <AskUniHeader />
      {memoryView ? null : <AskUniSourcesBar />}
      {memoryView ? (
        <AskUniMemory orgSlug={workspace.organization_slug} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" data-slot="ask-uni-body">
          {empty ? (
            <AskUniEmptyState kind={focus?.kind ?? null} onAsk={askSuggestion} disabled={streaming} model={model} look={look} />
          ) : (
            <AskUniThread
              conversationId={conversationId}
              stream={stream}
              wsId={workspace.id}
              askDefaults={{ model, effort, locale: i18n.language }}
            />
          )}
          {memoryHelp ? <AskUniMemoryHelp orgSlug={workspace.organization_slug} /> : null}
          <AskUniComposer
            // Sending is the end of "edit by chat": the strip has done its job.
            onSend={(input, display) => {
              setMemoryHelp(false);
              return stream.ask(input, display);
            }}
            onStop={stream.stop}
            streaming={streaming}
            attachments={canAttach ? attachments : undefined}
          />
        </div>
      )}
      {isDragOver ? <DropOverlay /> : null}
    </div>
  );
}
