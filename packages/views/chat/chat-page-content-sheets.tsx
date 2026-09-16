"use client";

import type { ReactNode } from "react";
import type { ChatCatchUpResponse } from "@uniwork/core/types";
import type { ChatNameContextEntry } from "./chat-page-utils";
import { ChatCatchUpSheet } from "./chat-catch-up-sheet";
import { ChatVoiceRecordingsSheet } from "./chat-voice-recordings-sheet";

export function ChatPageContentSheets({
  followUpSheet,
  catchUpOpen,
  onCatchUpOpenChange,
  catchUpLoading,
  catchUpError,
  catchUpResult,
  onCatchUpRetry,
  workspaceId,
  recordingsOpen,
  onRecordingsOpenChange,
  activeRoomId,
  currentUserId,
  nameContext,
}: {
  followUpSheet: ReactNode;
  catchUpOpen: boolean;
  onCatchUpOpenChange: (open: boolean) => void;
  catchUpLoading: boolean;
  catchUpError: string | null;
  catchUpResult: ChatCatchUpResponse | null;
  onCatchUpRetry: () => void;
  workspaceId: string;
  recordingsOpen: boolean;
  onRecordingsOpenChange: (open: boolean) => void;
  activeRoomId: string | null;
  currentUserId: string;
  nameContext: ChatNameContextEntry[];
}) {
  return (
    <>
      {followUpSheet}
      <ChatCatchUpSheet
        open={catchUpOpen}
        onOpenChange={onCatchUpOpenChange}
        loading={catchUpLoading}
        error={catchUpError}
        result={catchUpResult}
        onRetry={onCatchUpRetry}
        workspaceId={workspaceId}
      />
      {activeRoomId ? (
        <ChatVoiceRecordingsSheet
          open={recordingsOpen}
          onOpenChange={onRecordingsOpenChange}
          workspaceId={workspaceId}
          roomId={activeRoomId}
          currentUserId={currentUserId}
          nameContext={nameContext}
        />
      ) : null}
    </>
  );
}
