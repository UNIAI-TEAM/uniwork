"use client";

import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskUniStream } from "@uniwork/core/ai/stream";
import { useTranslation } from "react-i18next";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniComposer } from "./ask-uni-composer";
import { AskUniEmptyState } from "./ask-uni-empty";
import { AskUniHeader } from "./ask-uni-header";
import { useAskModelSelection } from "./ask-uni-model-picker";
import { useShownPage } from "./ask-uni-page-context";
import { AskUniThread } from "./ask-uni-thread";

/** The docked Ask UNI panel (flag ask_uni_stream): header, the conversation and the composer. */
export function AskUniPanel() {
  const { workspace } = useWorkspace();
  const { i18n } = useTranslation();
  const conversationId = useAiPanelStore((s) => s.conversationId);
  // The panel owns the stream so the thread and the composer share one live turn.
  const stream = useAskUniStream(workspace.id);
  const { model, effort } = useAskModelSelection(workspace.id);
  const page = useShownPage();
  const streaming = stream.state.status === "streaming";
  // A new conversation with nothing in flight starts from suggestions for the open page.
  const empty = conversationId === null && stream.state.status === "idle";
  const askSuggestion = (question: string) =>
    stream.ask({ question, focus: page ? { kind: page.kind, id: page.id } : undefined, mentions: [], model, effort, locale: i18n.language });
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-slot="ask-uni-panel">
      <AskUniHeader />
      <div className="flex min-h-0 flex-1 flex-col" data-slot="ask-uni-body">
        {empty ? (
          <AskUniEmptyState kind={page?.kind ?? null} onAsk={askSuggestion} disabled={streaming} />
        ) : (
          <AskUniThread
            conversationId={conversationId}
            stream={stream}
            wsId={workspace.id}
            askDefaults={{ model, effort, locale: i18n.language }}
          />
        )}
        <AskUniComposer onSend={stream.ask} onStop={stream.stop} streaming={streaming} />
      </div>
    </div>
  );
}
