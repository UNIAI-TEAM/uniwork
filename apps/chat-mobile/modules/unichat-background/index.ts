// What keeps the outbox going once UniChat leaves the screen (docs/engineering/unichat-mobile/offline-first.md ›
// Gửi tiếp ở nền). Each platform has its half:
// - iOS (ios/): time borrowed from the system as the app goes to the background (UIApplication.beginBackgroundTask),
//   about 30 s, so a message on the wire, or written just before the switch, finishes;
// - Android (android/): a WorkManager job (OutboxDrainWorker.kt) that needs a network, expedited on Android 12+, which
//   runs the "UniChatOutboxDrain" JavaScript task in the running app or a headless one: now when the network is
//   there, the moment it comes back when it is not, again with a backoff while something is still owed.
// The policy (when to borrow, schedule or give up) lives in data/outbox-drain/, tested with this module mocked. Null
// in Expo Go and in tests: data/outbox-drain/native-drain.ts turns every call into a no-op then.
import { requireOptionalNativeModule } from "expo";

export interface UniChatBackgroundModule {
  /** iOS: begins a background task named `name`; its id, or -1 when the system grants none. */
  beginGrace?(name: string): Promise<number>;
  /** iOS: ends it (once; the system's expiry may have ended it already). */
  endGrace?(id: number): Promise<void>;
  /**
   * Android: (re)places the one drain job, needing a connected network; `expedite` asks Android 12+ to run it at once
   * (as a normal job when the quota is spent). Older Android runs it as a normal job: an expedited one there would be
   * a foreground service with a notification of its own.
   */
  scheduleDrain?(expedite: boolean): void;
  /** Android: the job waiting or running goes (the app is back on screen). */
  cancelDrain?(): void;
  /** Android: the drain task's answer to the job that started it (`token`): `owed` makes the job try again later. */
  drainFinished?(token: string, owed: boolean): void;
}

export const UniChatBackground = requireOptionalNativeModule<UniChatBackgroundModule>("UniChatBackground");
