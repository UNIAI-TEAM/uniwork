/**
 * In-room signals (raise hand, reactions, host mute request) ride the
 * LiveKit data channel on one topic. Nothing here touches the server: the
 * signals are ephemeral and every client rebuilds state from the messages
 * it sees. This file is the pure part (encode / decode / reduce) so it can be
 * tested without a room.
 */
export const SIGNAL_TOPIC = "uw.signal";

export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👏"] as const;

export type MeetingSignal =
  | { kind: "hand"; value: boolean }
  | { kind: "reaction"; value: string }
  | { kind: "mute_request"; target: string };

type ReactionBubble = { id: string; identity: string; value: string; at: number };

export type SignalsState = {
  /** identities with a raised hand, oldest first */
  hands: string[];
  reactions: ReactionBubble[];
};

export const REACTION_TTL_MS = 3000;

export const initialSignalsState: SignalsState = { hands: [], reactions: [] };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeSignal(signal: MeetingSignal): Uint8Array {
  return encoder.encode(JSON.stringify(signal));
}

export function decodeSignal(payload: Uint8Array): MeetingSignal | null {
  try {
    const raw: unknown = JSON.parse(decoder.decode(payload));
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (r.kind === "hand" && typeof r.value === "boolean") return { kind: "hand", value: r.value };
    if (r.kind === "reaction" && typeof r.value === "string" && r.value.length <= 8) {
      return { kind: "reaction", value: r.value };
    }
    if (r.kind === "mute_request" && typeof r.target === "string") return { kind: "mute_request", target: r.target };
    return null;
  } catch {
    return null;
  }
}

/** Apply one signal from `from`. `now` keys the reaction bubble and its expiry. */
export function reduceSignal(state: SignalsState, from: string, signal: MeetingSignal, now: number): SignalsState {
  switch (signal.kind) {
    case "hand": {
      const without = state.hands.filter((h) => h !== from);
      return { ...state, hands: signal.value ? [...without, from] : without };
    }
    case "reaction": {
      const live = state.reactions.filter((r) => now - r.at < REACTION_TTL_MS);
      return { ...state, reactions: [...live, { id: `${from}:${now}`, identity: from, value: signal.value, at: now }] };
    }
    default:
      return state;
  }
}

export function expireReactions(state: SignalsState, now: number): SignalsState {
  const live = state.reactions.filter((r) => now - r.at < REACTION_TTL_MS);
  return live.length === state.reactions.length ? state : { ...state, reactions: live };
}

/** Drop the hand of someone who left the room. */
export function forgetIdentity(state: SignalsState, identity: string): SignalsState {
  if (!state.hands.includes(identity)) return state;
  return { ...state, hands: state.hands.filter((h) => h !== identity) };
}
