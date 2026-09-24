"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useDataChannel, useLocalParticipant, useParticipants, useTrackToggle } from "@livekit/components-react";
import { Track } from "livekit-client";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  decodeSignal,
  encodeSignal,
  expireReactions,
  forgetIdentity,
  initialSignalsState,
  reduceSignal,
  REACTION_TTL_MS,
  shouldHonorMuteRequest,
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

/**
 * The same state behind a subscription, so a tile can read one participant's
 * hand and reaction without re-rendering on everyone else's.
 */
type SignalsStore = {
  get: () => SignalsState;
  set: (next: SignalsState) => void;
  subscribe: (listener: () => void) => () => void;
};

function createSignalsStore(): SignalsStore {
  let state = initialSignalsState;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const StoreCtx = createContext<SignalsStore | null>(null);
const RequestMuteCtx = createContext<(identity: string) => void>(() => {});
const fallbackStore = createSignalsStore();

/** Client state for the room: lives only as long as the room is mounted. */
export function MeetingSignalsProvider({
  children,
  canHost = false,
  hostIdentities = [],
}: {
  children: ReactNode;
  canHost?: boolean;
  hostIdentities?: readonly string[];
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<SignalsState>(initialSignalsState);
  const [store] = useState(createSignalsStore);
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const localIdentity = localParticipant.identity;
  const hostIdentitiesRef = useRef(hostIdentities);
  hostIdentitiesRef.current = hostIdentities;
  const canHostRef = useRef(canHost);
  canHostRef.current = canHost;

  const { send } = useDataChannel(SIGNAL_TOPIC, (msg) => {
    const signal = decodeSignal(msg.payload);
    const from = msg.from?.identity;
    if (!signal || !from) return;
    if (signal.kind === "mute_request") {
      if (
        shouldHonorMuteRequest(from, hostIdentitiesRef.current) &&
        signal.target === localIdentity &&
        mic.enabled
      ) {
        void mic.toggle(false);
        // Muted by someone else: say so, or the viewer thinks the mic broke.
        // The toaster's own live region reads it out, each time.
        toast.info(t("meetings.hostMutedYou"), { description: t("meetings.hostMutedYouHint") });
      }
      return;
    }
    setState((s) => reduceSignal(s, from, signal, Date.now()));
  });

  const publish = useCallback(
    (signal: MeetingSignal) => {
      if (signal.kind === "mute_request" && !canHostRef.current) return;
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

  useEffect(() => {
    store.set(state);
  }, [store, state]);

  const publishRef = useRef(publish);
  publishRef.current = publish;
  const requestMute = useCallback(
    (identity: string) => publishRef.current({ kind: "mute_request", target: identity }),
    [],
  );

  const handRaised = state.hands.includes(localIdentity);
  const api = useMemo<SignalsApi>(
    () => ({
      ...state,
      localIdentity,
      handRaised,
      toggleHand: () => publish({ kind: "hand", value: !handRaised }),
      react: (value) => publish({ kind: "reaction", value }),
      requestMute,
    }),
    [state, localIdentity, handRaised, publish, requestMute],
  );

  return (
    <StoreCtx.Provider value={store}>
      <RequestMuteCtx.Provider value={requestMute}>
        <Ctx.Provider value={api}>
          {children}
        </Ctx.Provider>
      </RequestMuteCtx.Provider>
    </StoreCtx.Provider>
  );
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

/** One participant's hand and latest reaction; re-renders only when those change. */
export function useParticipantSignal(identity: string): {
  handRaised: boolean;
  reaction: SignalsState["reactions"][number] | undefined;
} {
  const store = useContext(StoreCtx) ?? fallbackStore;
  const handRaised = useSyncExternalStore(store.subscribe, () => store.get().hands.includes(identity));
  const reaction = useSyncExternalStore(store.subscribe, () =>
    store.get().reactions.filter((r) => r.identity === identity).at(-1),
  );
  return { handRaised, reaction };
}

/** Stable host-mute action, for components that must not re-render on every signal. */
export function useRequestMute(): (identity: string) => void {
  return useContext(RequestMuteCtx);
}
