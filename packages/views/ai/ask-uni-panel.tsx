"use client";

import { useAiPanelStore } from "@uniwork/core/ai";
import { useAskUniStream } from "@uniwork/core/ai/stream";
import { useWorkspace } from "../layout/workspace-context";
import { AskUniHeader } from "./ask-uni-header";
import { AskUniThread } from "./ask-uni-thread";

/** The docked Ask UNI panel (flag ask_uni_stream): header, the conversation, and the composer next. */
export function AskUniPanel() {
  const { workspace } = useWorkspace();
  const conversationId = useAiPanelStore((s) => s.conversationId);
  // The panel owns the stream so the thread and the composer (Task 13) share one live turn.
  const stream = useAskUniStream(workspace.id);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AskUniHeader />
      <div className="flex min-h-0 flex-1 flex-col" data-slot="ask-uni-body">
        <AskUniThread conversationId={conversationId} stream={stream} />
      </div>
    </div>
  );
}
