"use client";

import { AskUniHeader } from "./ask-uni-header";

/** The docked Ask UNI panel (flag ask_uni_stream): the header now; the thread and the composer fill the body next. */
export function AskUniPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <AskUniHeader />
      <div className="min-h-0 flex-1" data-slot="ask-uni-body" />
    </div>
  );
}
