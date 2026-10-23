// The background module (modules/unichat-background) as the drain uses it: each platform's half where it exists, a
// no-op for the other half and wherever the module is missing (Expo Go, tests), so no caller branches on whether a
// function is there; background-send.ts decides what each platform does.
import { UniChatBackground, type UniChatBackgroundModule } from "@/modules/unichat-background";

export interface NativeDrain {
  /** iOS: borrowed time as the app leaves the screen; its id, or null when there is none to have. */
  beginGrace: (name: string) => Promise<number | null>;
  endGrace: (id: number) => Promise<void>;
  /** Android: the job that drains now, or when a network is back (OutboxDrain.kt). */
  scheduleDrain: (expedite: boolean) => void;
  cancelDrain: () => void;
  /** Android: the drain task's answer to its job. */
  drainFinished: (token: string, owed: boolean) => void;
}

/** Each call goes to the module itself: a native module's functions expect it as `this`. */
export function nativeDrainFrom(module: UniChatBackgroundModule | null): NativeDrain {
  return {
    async beginGrace(name) {
      const id = await module?.beginGrace?.(name);
      return id === undefined || id < 0 ? null : id;
    },
    async endGrace(id) {
      await module?.endGrace?.(id);
    },
    scheduleDrain: (expedite) => module?.scheduleDrain?.(expedite),
    cancelDrain: () => module?.cancelDrain?.(),
    drainFinished: (token, owed) => module?.drainFinished?.(token, owed),
  };
}

export const nativeDrain: NativeDrain = nativeDrainFrom(UniChatBackground);
