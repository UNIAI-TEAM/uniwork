"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDataChannel, useLocalParticipant, useParticipants, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import {
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  reduceSignal,
  REACTION_TTL_MS,
  SIGNAL_TOPIC,
  type MeetingSignal,
  type SignalsState,
} from "./meeting-signals";

type SignalsApi = SignalsState & {
  localIdentity: string;
  handRaised: boolean;
  toggleHand: () => void;
  react: (value: string) => void;
  /** Host asks `identity` to mute; their client mutes itself and may unmute again. */
  requestMute: (identity: string) => void;
};

const Ctx = createContext<SignalsApi | null>(null);

/** Client state for the room: lives only as long as the room is mounted. */
export function MeetingSignalsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SignalsState>(initialSignalsState);
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const localIdentity = localParticipant.identity;

  const { send } = useDataChannel(SIGNAL_TOPIC, (msg) => {
    const signal = decodeSignal(msg.payload);
    const from = msg.from?.identity;
    if (!signal || !from) return;
    if (signal.kind === "mute_request") {
      if (signal.target === localIdentity && mic.enabled) void mic.toggle(false);
      return;
    }
    setState((s) => reduceSignal(s, from, signal, Date.now()));
  });

  const publish = useCallback(
    (signal: MeetingSignal) => {
      void send(encodeSignal(signal), { reliable: true, topic: SIGNAL_TOPIC });
      // LiveKit does not echo our own data messages: apply locally.
      if (signal.kind !== "mute_request") setState((s) => reduceSignal(s, localIdentity, signal, Date.now()));
    },
    [send, localIdentity],
  );

  // Reactions fade out on their own; run the sweep only while some exist.
  useEffect(() => {
    if (state.reactions.length === 0) return;
    const id = window.setTimeout(() => setState((s) => expireReactions(s, Date.now())), REACTION_TTL_MS);
    return () => window.clearTimeout(id);
  }, [state.reactions]);

  // A hand belongs to someone still in the room.
  useEffect(() => {
    const present = new Set(participants.map((p) => p.identity));
    setState((s) => s.hands.filter((h) => !present.has(h)).reduce(forgetIdentity, s));
  }, [participants]);

  const handRaised = state.hands.includes(localIdentity);
  const api = useMemo<SignalsApi>(
    () => ({
      ...state,
      localIdentity,
      handRaised,
      toggleHand: () => publish({ kind: "hand", value: !handRaised }),
      react: (value) => publish({ kind: "reaction", value }),
      requestMute: (identity) => publish({ kind: "mute_request", target: identity }),
    }),
    [state, localIdentity, handRaised, publish],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

const noop: SignalsApi = {
  ...initialSignalsState,
  localIdentity: "",
  handRaised: false,
  toggleHand: () => {},
  react: () => {},
  requestMute: () => {},
};

/** Outside the provider (tests, previews) every signal is a no-op. */
export function useMeetingSignals(): SignalsApi {
  return useContext(Ctx) ?? noop;
}
