"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";
import {
  createWorkspaceAwareStorage,
  registerForWorkspaceRehydration,
} from "../platform/workspace-storage";
import type { CreatePollInput, RoomPollSettings } from "./poll-utils";
import { mergePollSettings, normalizePollOptions } from "./poll-utils";
import type { ReminderRepeat } from "./reminder-utils";

export type RoomReminder = {
  id: string;
  body: string;
  remindAt: string;
  repeat: ReminderRepeat;
  createdAt: string;
  createdBy?: string;
  /** Legacy bulletin entries stored a title field. */
  title?: string;
};

export type RoomNote = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

export type RoomPollOption = {
  id: string;
  label: string;
  votes: number;
};

export type RoomPoll = {
  id: string;
  question: string;
  options: RoomPollOption[];
  settings: RoomPollSettings;
  createdAt: string;
  createdBy?: string;
};

type RoomBulletinState = {
  remindersByRoomId: Record<string, RoomReminder[]>;
  notesByRoomId: Record<string, RoomNote[]>;
  pollsByRoomId: Record<string, RoomPoll[]>;
  pollVotesById: Record<string, string[]>;
  addReminder: (roomId: string, input: { body: string; remindAt: string; repeat?: ReminderRepeat; createdBy?: string }) => void;
  addNote: (roomId: string, input: { title: string; body: string }) => void;
  addPoll: (roomId: string, input: CreatePollInput) => string | null;
  votePoll: (
    roomId: string,
    pollId: string,
    optionId: string,
    voterId: string,
  ) => void;
  addPollOption: (roomId: string, pollId: string, label: string) => void;
  advanceReminder: (roomId: string, reminderId: string, nextRemindAt: string) => void;
  removeReminder: (roomId: string, reminderId: string) => void;
};

function nextId(): string {
  return `rb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatRoomBulletinStore = create<RoomBulletinState>()(
  persist(
    (set, get) => ({
      remindersByRoomId: {},
      notesByRoomId: {},
      pollsByRoomId: {},
      pollVotesById: {},
      addReminder: (roomId, input) => {
        const body = input.body.trim();
        if (!body) return;
        const entry: RoomReminder = {
          id: nextId(),
          body,
          remindAt: input.remindAt,
          repeat: input.repeat ?? "none",
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy,
        };
        set((state) => ({
          remindersByRoomId: {
            ...state.remindersByRoomId,
            [roomId]: [...(state.remindersByRoomId[roomId] ?? []), entry],
          },
        }));
      },
      addNote: (roomId, input) => {
        const title = input.title.trim();
        const body = input.body.trim();
        if (!title || !body) return;
        const entry: RoomNote = {
          id: nextId(),
          title,
          body,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          notesByRoomId: {
            ...state.notesByRoomId,
            [roomId]: [...(state.notesByRoomId[roomId] ?? []), entry],
          },
        }));
      },
      addPoll: (roomId, input) => {
        const question = input.question.trim();
        const options = normalizePollOptions(input.options);
        if (!question || options.length < 2) return null;
        const entry: RoomPoll = {
          id: nextId(),
          question,
          options: options.map((label) => ({ id: nextId(), label, votes: 0 })),
          settings: mergePollSettings(input.settings),
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy,
        };
        set((state) => ({
          pollsByRoomId: {
            ...state.pollsByRoomId,
            [roomId]: [...(state.pollsByRoomId[roomId] ?? []), entry],
          },
        }));
        return entry.id;
      },
      votePoll: (roomId, pollId, optionId, voterId) => {
        const polls = get().pollsByRoomId[roomId] ?? [];
        const poll = polls.find((entry) => entry.id === pollId);
        if (!poll) return;

        const voteKey = `${roomId}:${pollId}:${voterId}`;
        const previousVotes = get().pollVotesById[voteKey] ?? [];
        const allowMultiple = poll.settings.allowMultiple;

        let nextVotes: string[];
        if (allowMultiple) {
          nextVotes = previousVotes.includes(optionId)
            ? previousVotes.filter((id) => id !== optionId)
            : [...previousVotes, optionId];
        } else {
          nextVotes = previousVotes.includes(optionId) ? [] : [optionId];
        }

        set((state) => ({
          pollVotesById: {
            ...state.pollVotesById,
            [voteKey]: nextVotes,
          },
          pollsByRoomId: {
            ...state.pollsByRoomId,
            [roomId]: polls.map((entry) => {
              if (entry.id !== pollId) return entry;
              return {
                ...entry,
                options: entry.options.map((option) => {
                  const wasSelected = previousVotes.includes(option.id);
                  const isSelected = nextVotes.includes(option.id);
                  if (wasSelected === isSelected) return option;
                  return {
                    ...option,
                    votes: Math.max(0, option.votes + (isSelected ? 1 : -1)),
                  };
                }),
              };
            }),
          },
        }));
      },
      addPollOption: (roomId, pollId, label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        const polls = get().pollsByRoomId[roomId] ?? [];
        set({
          pollsByRoomId: {
            ...get().pollsByRoomId,
            [roomId]: polls.map((poll) =>
              poll.id !== pollId || !poll.settings.allowAddOptions
                ? poll
                : {
                    ...poll,
                    options: [...poll.options, { id: nextId(), label: trimmed, votes: 0 }],
                  },
            ),
          },
        });
      },
      advanceReminder: (roomId, reminderId, nextRemindAt) => {
        set((state) => ({
          remindersByRoomId: {
            ...state.remindersByRoomId,
            [roomId]: (state.remindersByRoomId[roomId] ?? []).map((entry) =>
              entry.id === reminderId ? { ...entry, remindAt: nextRemindAt } : entry,
            ),
          },
        }));
      },
      removeReminder: (roomId, reminderId) => {
        set((state) => ({
          remindersByRoomId: {
            ...state.remindersByRoomId,
            [roomId]: (state.remindersByRoomId[roomId] ?? []).filter((entry) => entry.id !== reminderId),
          },
        }));
      },
    }),
    {
      name: "uniwork_chat_room_bulletin",
      storage: createJSONStorage(() => createWorkspaceAwareStorage(defaultStorage)),
      partialize: (state) => ({
        remindersByRoomId: state.remindersByRoomId,
        notesByRoomId: state.notesByRoomId,
        pollsByRoomId: state.pollsByRoomId,
        pollVotesById: state.pollVotesById,
      }),
    },
  ),
);

registerForWorkspaceRehydration(() => void useChatRoomBulletinStore.persist.rehydrate());

export function resetChatRoomBulletinForTests(): void {
  useChatRoomBulletinStore.setState({
    remindersByRoomId: {},
    notesByRoomId: {},
    pollsByRoomId: {},
    pollVotesById: {},
  });
}

export function getPollVotesForUser(
  roomId: string,
  pollId: string,
  voterId: string,
): string[] {
  return useChatRoomBulletinStore.getState().pollVotesById[`${roomId}:${pollId}:${voterId}`] ?? [];
}
